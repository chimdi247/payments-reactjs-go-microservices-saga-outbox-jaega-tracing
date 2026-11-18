package gateway

import (
	"context"
	_ "embed"
	"fmt"
	"log/slog"
	"math"
	"net"
	"net/http"
	"strconv"
	"time"

	"github.com/fiston-user/payments/internal/platform/authn"
	"github.com/fiston-user/payments/internal/platform/httpx"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/redis/go-redis/v9"
)

// limiterErrors counts requests the limiter couldn't judge because Redis
// failed, by what we did: allowed (fail open) or rejected (fail closed).
// It should stay flat: alert on it.
var limiterErrors = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "gateway_ratelimit_errors_total",
	Help: "Requests the rate limiter could not decide on, by outcome: allowed or rejected.",
}, []string{"outcome"})

func init() {
	limiterErrors.WithLabelValues("allowed")
	limiterErrors.WithLabelValues("rejected")
}

//go:embed ratelimit.lua
var tokenBucketLua string

// tokenBucket runs with EVALSHA: after the first call, only its hash is sent.
var tokenBucket = redis.NewScript(tokenBucketLua)

// A Limiter allows each client limit requests per period. Its buckets live in
// Redis, so every gateway instance shares them.
type Limiter struct {
	rdb    *redis.Client
	limit  int
	period time.Duration
}

// NewLimiter returns a Limiter that keeps its buckets in rdb.
func NewLimiter(rdb *redis.Client, limit int, period time.Duration) *Limiter {
	return &Limiter{rdb: rdb, limit: limit, period: period}
}

// A Decision is the limiter's answer for one request.
type Decision struct {
	Allowed    bool
	Remaining  int           // requests left right now
	RetryAfter time.Duration // until the next request is allowed
}

// Allow takes a token from key's bucket, if there's one left.
func (l *Limiter) Allow(ctx context.Context, key string) (Decision, error) {
	res, err := tokenBucket.Run(ctx, l.rdb, []string{"ratelimit:" + key},
		l.limit, l.period.Milliseconds()).Int64Slice()
	if err != nil {
		return Decision{}, fmt.Errorf("rate limit %s: %w", key, err)
	}
	return Decision{
		Allowed:    res[0] == 1,
		Remaining:  int(res[1]),
		RetryAfter: time.Duration(res[2]) * time.Millisecond,
	}, nil
}

// Middleware limits requests per client, as key names them. If Redis is
// down, requests are allowed: use it for routes where that's safe.
func (l *Limiter) Middleware(key func(*http.Request) string) httpx.Middleware {
	return l.middleware(key, false)
}

// StrictMiddleware is Middleware, but fails closed: if Redis is down, the
// request is refused. It's for routes where an unlimited caller does damage:
// guessing passwords, moving money.
func (l *Limiter) StrictMiddleware(key func(*http.Request) string) httpx.Middleware {
	return l.middleware(key, true)
}

func (l *Limiter) middleware(key func(*http.Request) string, failClosed bool) httpx.Middleware {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			d, err := l.Allow(r.Context(), key(r))
			if err != nil {
				if failClosed {
					limiterErrors.WithLabelValues("rejected").Inc()
					slog.ErrorContext(r.Context(), "rate limiter unavailable, request refused", "err", err)
					w.Header().Set("Retry-After", "5")
					httpx.Error(w, r, errLimiterDown)
					return
				}
				// Fail open: Redis being down mustn't take the whole API down.
				limiterErrors.WithLabelValues("allowed").Inc()
				slog.WarnContext(r.Context(), "rate limiter unavailable, request allowed", "err", err)
				next.ServeHTTP(w, r)
				return
			}
			w.Header().Set("X-RateLimit-Limit", strconv.Itoa(l.limit))
			w.Header().Set("X-RateLimit-Remaining", strconv.Itoa(d.Remaining))
			if !d.Allowed {
				secs := math.Ceil(d.RetryAfter.Seconds()) // whole seconds, rounded up
				w.Header().Set("Retry-After", strconv.Itoa(int(secs)))
				httpx.Error(w, r, errRateLimited)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// clientIP keys public routes on the client's IP address.
func clientIP(r *http.Request) string {
	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		ip = r.RemoteAddr
	}
	return "ip:" + ip
}

// authKey keys the credential routes on the client's IP address, apart from
// the general limit: a password-guesser gets its own, much smaller, bucket.
func authKey(r *http.Request) string {
	return "auth:" + clientIP(r)
}

// userID keys private routes on the user that authn.Require found.
func userID(r *http.Request) string {
	id, _ := authn.UserID(r.Context())
	return "user:" + id.String()
}
