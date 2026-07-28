package test

import (
	"testing"

	w2s "blissbase/whatsapp2sqlite"

	"go.mau.fi/whatsmeow/types"
)

func TestR2ManagerMediaObjectKey(t *testing.T) {
	t.Parallel()

	key := w2s.TestMediaObjectKey(`media`, `120363@g.us`, types.MessageID(`ABC/123`), `.jpg`)
	if key != `media/120363@g.us/ABC_123.jpg` {
		t.Fatalf(`got %q`, key)
	}
}

func TestEnqueueMediaHelpersNilSafe(t *testing.T) {
	t.Parallel()
	w2s.TestEnqueueMediaNilSafe()
}
