package transfer

import (
	"context"
	"time"

	"github.com/fiston-user/payments/internal/transfer/risk"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.opentelemetry.io/otel"
)

var tracer = otel.Tracer("github.com/fiston-user/payments/internal/transfer")

var (
	transfersFinished = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "transfers_finished_total",
		Help: "Transfers that reached a final state: completed, failed or reversed.",
	}, []string{"state"})
	stepRetries = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "transfer_step_retries_total",
		Help: "Saga steps that failed, and will be tried again, by step.",
	}, []string{"step"})
	riskDecisions = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "risk_decisions_total",
		Help: "Transfers the risk engine allowed, sent to review, or denied.",
	}, []string{"decision"})
)

// Every series starts at zero, so increase() sees the first transfer too.
func init() {
	for _, s := range []State{Completed, Failed, Reversed} {
		transfersFinished.WithLabelValues(string(s))
	}
	for _, step := range saga {
		stepRetries.WithLabelValues(step.name)
	}
	for _, d := range []risk.Decision{risk.Allow, risk.Review, risk.Deny} {
		riskDecisions.WithLabelValues(d.String())
	}
}

// finished counts t, if its saga is over.
func finished(t Transfer) {
	if t.State.Final() {
		transfersFinished.WithLabelValues(string(t.State)).Inc()
	}
}

// inflight reports, at every scrape, the transfers that haven't finished, by
// state, and how long the oldest of each has been waiting. A saga step that
// keeps failing shows up here as an age that only grows: alert on it.
type inflight struct {
	pool  *pgxpool.Pool
	count *prometheus.Desc
	age   *prometheus.Desc
}

// RegisterInflightMetrics exports transfers_inflight and
// transfers_inflight_oldest_seconds, read from pool when Prometheus scrapes.
func RegisterInflightMetrics(pool *pgxpool.Pool) {
	prometheus.MustRegister(&inflight{
		pool:  pool,
		count: prometheus.NewDesc("transfers_inflight", "Transfers that haven't reached a final state, by state.", []string{"state"}, nil),
		age: prometheus.NewDesc("transfers_inflight_oldest_seconds",
			"Age of the oldest unfinished transfer, by state.", []string{"state"}, nil),
	})
}

func (c *inflight) Describe(ch chan<- *prometheus.Desc) { ch <- c.count; ch <- c.age }

func (c *inflight) Collect(ch chan<- prometheus.Metric) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	// The states match the partial index on unfinished transfers: only those rows are read.
	rows, err := c.pool.Query(ctx, `SELECT state, count(*), coalesce(extract(epoch FROM now() - min(created_at)), 0)
		FROM transfers WHERE state IN ('pending', 'in_review', 'funds_held', 'compensating') GROUP BY state`)
	if err != nil {
		return // a scrape without these is itself a signal: absent() alerts catch it
	}
	defer rows.Close()
	for rows.Next() {
		var state string
		var n int64
		var age float64
		if rows.Scan(&state, &n, &age) != nil {
			return
		}
		ch <- prometheus.MustNewConstMetric(c.count, prometheus.GaugeValue, float64(n), state)
		ch <- prometheus.MustNewConstMetric(c.age, prometheus.GaugeValue, age, state)
	}
}
