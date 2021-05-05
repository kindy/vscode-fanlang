
src/fan.peg.js: src/fan.pegjs
	./node_modules/.bin/peggy -o $@ $<
