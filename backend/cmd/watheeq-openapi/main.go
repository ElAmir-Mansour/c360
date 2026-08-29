package main

import (
	"fmt"
	"os"

	"github.com/clario360/platform/internal/lex/apidocs"
)

func main() {
	document, err := apidocs.DocumentJSON()
	if err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "build Watheeq OpenAPI document: %v\n", err)
		os.Exit(1)
	}
	if _, err := os.Stdout.Write(document); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "write Watheeq OpenAPI document: %v\n", err)
		os.Exit(1)
	}
}
