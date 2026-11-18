package webhook

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"math/rand/v2"
	"time"

	"github.com/fiston-user/payments/internal/platform/events"
	"github.com/fiston-user/payments/internal/platform/natsx"
	"github.com/fiston-user/payments/internal/platform/telemetry"
	"github.com/fiston-user/payments/internal/transfer/transferevents"
	"github.com/fiston-user/payments/internal/webhook/webhookdb"
	"github.com/google/uuid"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/trace"
)

var tracer = otel.Tracer("github.com/fiston-user/payments/internal/webhook")

// A Payload is what a receiver gets: the event, in an envelope of our own,
// which stays the same whatever changes inside our system.
type Payload struct {
	ID        uuid.UUID       `json:"id"`
	Type      string          `json:"type"`
	CreatedAt time.Time       `json:"created_at"`
	Data      json.RawMessage `json:"data"`
}

// fanOutDropped should stay at zero: events we gave up on, by why.
var fanOutDropped = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "webhook_fanout_dropped_total",
	Help: "Events the webhook fan-out gave up on, by reason: undecodable or exhausted.",
}, []string{"reason"})

func init() {
	fanOutDropped.WithLabelValues("undecodable")
	fanOutDropped.WithLabelValues("exhausted")
}

// maxDeliveries is how often NATS tries one event before we give up on it.
const maxDeliveries = 10

var errUndecodable = errors.New("undecodable event")

// FanOut turns transfer events into deliveries, one for each endpoint that
// wants them. It's a durable consumer, like the notification service's.
type FanOut struct {
	q      *webhookdb.Queries
	wake   func()
	logger *slog.Logger
}

// NewFanOut returns a FanOut that wakes the worker when there's work.
func NewFanOut(q *webhookdb.Queries, wake func(), logger *slog.Logger) *FanOut {
	return &FanOut{q: q, wake: wake, logger: logger}
}

// Consume starts the durable consumer on the TRANSFER stream.
func (f *FanOut) Consume(ctx context.Context, js jetstream.JetStream) (jetstream.ConsumeContext, error) {
	if err := natsx.WaitForStream(ctx, js, transferevents.Stream); err != nil {
		return nil, err
	}
	consumer, err := js.CreateOrUpdateConsumer(ctx, transferevents.Stream, jetstream.ConsumerConfig{
		Durable:        "webhook",
		Description:    "turns transfer events into webhook deliveries",
		FilterSubjects: []string{"transfer.events.>"},
		DeliverPolicy:  jetstream.DeliverNewPolicy,
		AckPolicy:      jetstream.AckExplicitPolicy,
		AckWait:        30 * time.Second,
		MaxDeliver:     maxDeliveries,
		MaxAckPending:  200, // in flight at once, across every instance
	})
	if err != nil {
		return nil, fmt.Errorf("consumer on %s: %w", transferevents.Stream, err)
	}
	return consumer.Consume(f.handle)
}

func (f *FanOut) handle(msg jetstream.Msg) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	ctx, span := tracer.Start(telemetry.Extract(ctx, natsx.HeaderCarrier{Header: msg.Headers()}),
		"fan out "+msg.Subject(), trace.WithSpanKind(trace.SpanKindConsumer))
	defer span.End()

	n, err := f.fanOut(ctx, msg.Data())
	switch {
	case errors.Is(err, errUndecodable):
		f.logger.ErrorContext(ctx, "dropping event", "subject", msg.Subject(), "err", err)
		fanOutDropped.WithLabelValues("undecodable").Inc()
		msg.Term() // retrying can't fix it
	case err != nil:
		var delivered uint64 = 1
		if meta, merr := msg.Metadata(); merr == nil {
			delivered = meta.NumDelivered
		}
		if delivered >= maxDeliveries {
			f.logger.ErrorContext(ctx, "fan out failed for good: dropping event",
				"subject", msg.Subject(), "deliveries", delivered, "err", err)
			fanOutDropped.WithLabelValues("exhausted").Inc()
			msg.Term()
			return
		}
		delay := min(time.Second<<min(delivered-1, 6), time.Minute)
		delay = (delay/2 + rand.N(delay/2+1)).Round(time.Millisecond)
		f.logger.WarnContext(ctx, "fan out failed, retrying", "in", delay, "err", err)
		msg.NakWithDelay(delay)
	default:
		if n > 0 {
			f.wake()
		}
		msg.Ack()
	}
}

// fanOut writes the deliveries for one event. The same event, delivered again
// by NATS, finds its deliveries already there, and writes nothing.
func (f *FanOut) fanOut(ctx context.Context, data []byte) (int64, error) {
	var evt events.Event
	var t transferevents.Transfer
	if err := json.Unmarshal(data, &evt); err != nil {
		return 0, fmt.Errorf("%w: %w", errUndecodable, err)
	}
	if err := json.Unmarshal(evt.Data, &t); err != nil {
		return 0, fmt.Errorf("%w: %s: %w", errUndecodable, evt.Type, err)
	}
	payload, err := json.Marshal(Payload{ID: evt.ID, Type: evt.Type, CreatedAt: evt.OccurredAt, Data: evt.Data})
	if err != nil {
		return 0, err
	}
	return f.q.FanOut(ctx, webhookdb.FanOutParams{
		UserID: t.UserID, EventID: evt.ID, EventType: evt.Type, Payload: payload,
	})
}
