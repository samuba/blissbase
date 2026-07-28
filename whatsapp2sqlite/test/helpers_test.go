package test

import (
	"context"
	"errors"
	"net"
	"strings"
	"testing"
	"time"

	w2s "blissbase/whatsapp2sqlite"

	waCommon "go.mau.fi/whatsmeow/proto/waCommon"
	waE2E "go.mau.fi/whatsmeow/proto/waE2E"
	"go.mau.fi/whatsmeow/types"
	"go.mau.fi/whatsmeow/types/events"
	"google.golang.org/protobuf/proto"
)

func TestShouldStoreMessage(t *testing.T) {
	t.Parallel()

	cases := []struct {
		name    string
		message *waE2E.Message
		want    bool
	}{
		{name: `nil`, message: nil, want: false},
		{name: `empty`, message: &waE2E.Message{}, want: false},
		{name: `conversation`, message: &waE2E.Message{Conversation: proto.String(`hi`)}, want: true},
		{name: `extended`, message: &waE2E.Message{ExtendedTextMessage: &waE2E.ExtendedTextMessage{Text: proto.String(`hi`)}}, want: true},
		{name: `image`, message: &waE2E.Message{ImageMessage: &waE2E.ImageMessage{}}, want: true},
		{name: `video`, message: &waE2E.Message{VideoMessage: &waE2E.VideoMessage{}}, want: true},
		{name: `document`, message: &waE2E.Message{DocumentMessage: &waE2E.DocumentMessage{}}, want: true},
		{name: `audio`, message: &waE2E.Message{AudioMessage: &waE2E.AudioMessage{}}, want: true},
		{name: `sticker`, message: &waE2E.Message{StickerMessage: &waE2E.StickerMessage{}}, want: true},
		{name: `event`, message: &waE2E.Message{EventMessage: &waE2E.EventMessage{Name: proto.String(`party`)}}, want: true},
		{name: `reaction`, message: &waE2E.Message{ReactionMessage: &waE2E.ReactionMessage{Text: proto.String(`x`)}}, want: false},
		{name: `protocol`, message: &waE2E.Message{ProtocolMessage: &waE2E.ProtocolMessage{}}, want: false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			if got := w2s.TestShouldStoreMessage(tc.message); got != tc.want {
				t.Fatalf(`shouldStoreMessage() = %v, want %v`, got, tc.want)
			}
		})
	}
}

func TestDescribeMessage(t *testing.T) {
	t.Parallel()

	messageType, text := w2s.TestDescribeMessage(&waE2E.Message{Conversation: proto.String(`hello`)})
	if messageType != `conversation` || text != `hello` {
		t.Fatalf(`got (%q, %q)`, messageType, text)
	}

	messageType, text = w2s.TestDescribeMessage(&waE2E.Message{
		ImageMessage: &waE2E.ImageMessage{Caption: proto.String(`pic`)},
	})
	if messageType != `image` || text != `pic` {
		t.Fatalf(`got (%q, %q)`, messageType, text)
	}

	messageType, text = w2s.TestDescribeMessage(nil)
	if messageType != `` || text != `` {
		t.Fatalf(`nil: got (%q, %q)`, messageType, text)
	}
}

func TestNormalizePhoneNumberJID(t *testing.T) {
	t.Parallel()

	cases := []struct {
		jid  types.JID
		want string
	}{
		{jid: userJID(`491701234567`), want: `+491701234567`},
		{jid: types.NewJID(`491701234567`, types.HostedServer), want: `+491701234567`},
		{jid: types.NewJID(`abc`, types.DefaultUserServer), want: ``},
		{jid: types.NewJID(`491701234567`, types.GroupServer), want: ``},
		{jid: types.EmptyJID, want: ``},
	}

	for _, tc := range cases {
		if got := w2s.TestNormalizePhoneNumberJID(tc.jid); got != tc.want {
			t.Fatalf(`normalizePhoneNumberJID(%v) = %q, want %q`, tc.jid, got, tc.want)
		}
	}
}

func TestExtractSenderPhoneNumber(t *testing.T) {
	t.Parallel()

	sender := types.NewJID(`123`, types.HiddenUserServer)
	alt := userJID(`491701234567`)
	if got := w2s.TestExtractSenderPhoneNumber(sender, alt); got != `+491701234567` {
		t.Fatalf(`got %q`, got)
	}

	if got := w2s.TestExtractSenderPhoneNumber(userJID(`491709999999`), alt); got != `+491709999999` {
		t.Fatalf(`primary wins: got %q`, got)
	}
}

func TestMessageRetentionCutoff(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, 7, 28, 12, 0, 0, 0, time.UTC)
	got := w2s.TestMessageRetentionCutoff(now)
	want := now.Add(-w2s.TestMessageRetentionWindow)
	if !got.Equal(want) {
		t.Fatalf(`got %v, want %v`, got, want)
	}
}

func TestMediaExtension(t *testing.T) {
	t.Parallel()

	cases := []struct {
		mime, kind, want string
	}{
		{`image/jpeg`, `image`, `.jpg`},
		{`image/png`, `image`, `.png`},
		{`video/mp4`, `video`, `.mp4`},
		{`audio/ogg`, `audio`, `.ogg`},
		{`application/pdf`, `document`, `.pdf`},
		{`application/octet-stream`, `sticker`, `.bin`},
		{``, `sticker`, `.webp`},
		{`application/octet-stream`, `image`, `.bin`},
	}

	for _, tc := range cases {
		if got := w2s.TestMediaExtension(tc.mime, tc.kind); got != tc.want {
			t.Fatalf(`mediaExtension(%q, %q) = %q, want %q`, tc.mime, tc.kind, got, tc.want)
		}
	}
}

func TestSanitizePathSegment(t *testing.T) {
	t.Parallel()

	if got := w2s.TestSanitizePathSegment(`120363@g.us`); got != `120363@g.us` {
		t.Fatalf(`got %q`, got)
	}
	if got := w2s.TestSanitizePathSegment(`a/b`); got != `a_b` {
		t.Fatalf(`got %q`, got)
	}
	if got := w2s.TestSanitizePathSegment(``); got != `unknown` {
		t.Fatalf(`empty: got %q`, got)
	}
}

func TestParseR2ObjectURI(t *testing.T) {
	t.Parallel()

	bucket, key, ok := w2s.TestParseR2ObjectURI(`r2://my-bucket/media/chat/msg.jpg`)
	if !ok || bucket != `my-bucket` || key != `media/chat/msg.jpg` {
		t.Fatalf(`got %q %q %v`, bucket, key, ok)
	}

	if _, _, ok := w2s.TestParseR2ObjectURI(`https://example.com/x`); ok {
		t.Fatal(`expected non-r2 URI to fail`)
	}
	if _, _, ok := w2s.TestParseR2ObjectURI(`r2://bucket-only`); ok {
		t.Fatal(`expected missing key to fail`)
	}
}

func TestR2ObjectURI(t *testing.T) {
	t.Parallel()

	if got := w2s.TestR2ObjectURI(`bucket`, `/media/a.jpg`); got != `r2://bucket/media/a.jpg` {
		t.Fatalf(`got %q`, got)
	}
}

func TestStripJSONCComments(t *testing.T) {
	t.Parallel()

	input := []byte(`{
  // line comment
  "a": "https://x.com", /* block */
  "b": 1
}`)
	got := string(w2s.TestStripJSONCComments(input))
	if !strings.Contains(got, `"a": "https://x.com"`) || !strings.Contains(got, `"b": 1`) {
		t.Fatalf(`unexpected output: %s`, got)
	}
	if strings.Contains(got, `line comment`) || strings.Contains(got, `block`) {
		t.Fatalf(`comments not stripped: %s`, got)
	}
}

func TestSqliteStringLiteral(t *testing.T) {
	t.Parallel()

	if got := w2s.TestSqliteStringLiteral(`o'reilly`); got != `'o''reilly'` {
		t.Fatalf(`got %q`, got)
	}
}

func TestIsTransientPostgresError(t *testing.T) {
	t.Parallel()

	if w2s.TestIsTransientPostgresError(nil) {
		t.Fatal(`nil should not be transient`)
	}
	if w2s.TestIsTransientPostgresError(context.Canceled) {
		t.Fatal(`context.Canceled should not be transient`)
	}
	if !w2s.TestIsTransientPostgresError(errors.New(`connection reset by peer`)) {
		t.Fatal(`connection reset should be transient`)
	}
	if !w2s.TestIsTransientPostgresError(&net.DNSError{IsTimeout: true, Err: `i/o timeout`}) {
		t.Fatal(`net.Error should be transient`)
	}
}

func TestGetRevokedMessageID(t *testing.T) {
	t.Parallel()

	if id := w2s.TestGetRevokedMessageID(nil); id != `` {
		t.Fatalf(`nil: %q`, id)
	}

	evt := &events.Message{
		Message: &waE2E.Message{
			ProtocolMessage: &waE2E.ProtocolMessage{
				Type: waE2E.ProtocolMessage_REVOKE.Enum(),
				Key:  &waCommon.MessageKey{ID: proto.String(`abc123`)},
			},
		},
	}
	if id := w2s.TestGetRevokedMessageID(evt); id != `abc123` {
		t.Fatalf(`got %q`, id)
	}

	evt.Message.ProtocolMessage.Type = waE2E.ProtocolMessage_MESSAGE_EDIT.Enum()
	if id := w2s.TestGetRevokedMessageID(evt); id != `` {
		t.Fatalf(`edit should not revoke: %q`, id)
	}
}

func TestFirstNonEmpty(t *testing.T) {
	t.Parallel()

	if got := w2s.TestFirstNonEmpty(``, `keep`, `later`); got != `keep` {
		t.Fatalf(`got %q`, got)
	}
	if got := w2s.TestFirstNonEmpty(``, ``); got != `` {
		t.Fatalf(`all empty: got %q`, got)
	}
}
