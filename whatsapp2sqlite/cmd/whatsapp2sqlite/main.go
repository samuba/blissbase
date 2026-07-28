package main

import (
	"log"

	whatsapp2sqlite "blissbase/whatsapp2sqlite"
)

func main() {
	if err := whatsapp2sqlite.Main(); err != nil {
		log.Fatal(err)
	}
}
