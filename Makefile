.PHONY: all clean test

SERVICE ?= ackmud-web

all:
	systemctl restart $(SERVICE)

test:
	python3 test_integration.py

clean:
	@:
