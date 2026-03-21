.PHONY: all clean test

SERVICE ?= web-server

all:
	systemctl restart $(SERVICE)

test:
	python3 test_integration.py

clean:
	@:
