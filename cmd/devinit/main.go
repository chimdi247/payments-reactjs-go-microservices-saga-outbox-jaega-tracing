// Command devinit prepares the development secrets that docker compose needs,
// so a fresh checkout starts with one command: no make, openssl or Go
// toolchain on the host. It does what `make keys` and `make certs` do, into
// one directory, which compose keeps in a volume that every service mounts
// read-only.
//
//	devinit -dir /pki
//
// It is idempotent: once the directory has its .ready marker, it does
// nothing, so every service keeps trusting the same CA across restarts.
// `docker compose down -v` throws the volume away, and the next `up` issues
// everything again. Throwaway material for development only.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/pem"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"time"

	"github.com/fiston-user/payments/internal/platform/mtls/devca"
)

// The services that get a certificate: the same list as `make certs`.
var services = []string{"gateway", "wallet", "auth", "transfer", "notification", "ops"}

func main() {
	dir := flag.String("dir", "/pki", "where to write the keys and certificates")
	owner := flag.Int("owner", 65532, "the uid and gid that run our services (distroless nonroot)")
	validity := flag.Duration("valid", 365*24*time.Hour, "how long the certificates last")
	flag.Parse()

	marker := filepath.Join(*dir, ".ready")
	if _, err := os.Stat(marker); err == nil {
		fmt.Printf("devinit: %s is already initialised, keeping it\n", *dir)
		return
	}
	if err := run(*dir, *owner, *validity); err != nil {
		log.Fatalf("devinit: %v", err)
	}
	if err := os.WriteFile(marker, []byte(time.Now().UTC().Format(time.RFC3339)+"\n"), 0o644); err != nil {
		log.Fatalf("devinit: %v", err)
	}
	fmt.Printf("devinit: keys and certificates for %d services in %s, valid for %s\n",
		len(services), *dir, *validity)
}

func run(dir string, owner int, validity time.Duration) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	if err := writeAuthKeys(dir); err != nil {
		return err
	}
	ca, err := devca.New(validity)
	if err != nil {
		return err
	}
	tlsDir := filepath.Join(dir, "tls")
	for _, name := range services {
		if err := ca.Write(tlsDir, name); err != nil {
			return fmt.Errorf("certificate for %s: %w", name, err)
		}
	}
	// Our services run as an unprivileged user, and must be able to read what
	// we wrote as root.
	return filepath.WalkDir(dir, func(path string, _ fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		return os.Chown(path, owner, owner)
	})
}

// writeAuthKeys writes the Ed25519 pair that signs and verifies access
// tokens, in the formats the auth service and `openssl genpkey` use: a
// PKCS #8 private key, and a PKIX public key.
func writeAuthKeys(dir string) error {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		return err
	}
	pubDER, err := x509.MarshalPKIXPublicKey(pub)
	if err != nil {
		return err
	}
	if err := writePEM(filepath.Join(dir, "auth_ed25519.pem"), "PRIVATE KEY", privDER, 0o600); err != nil {
		return err
	}
	return writePEM(filepath.Join(dir, "auth_ed25519.pub.pem"), "PUBLIC KEY", pubDER, 0o644)
}

func writePEM(path, typ string, der []byte, perm os.FileMode) error {
	return os.WriteFile(path, pem.EncodeToMemory(&pem.Block{Type: typ, Bytes: der}), perm)
}
