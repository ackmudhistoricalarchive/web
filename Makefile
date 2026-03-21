.PHONY: all clean

all:
	chmod a+x web_who_server.py
	pkill -f web_who_server.py || true
	nohup ./web_who_server.py &

clean:
	@:
