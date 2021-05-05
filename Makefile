
src/fan.peg.js: src/fan.pegjs
	./node_modules/.bin/peggy -o $@ $<

prod: src/fan.peg.js
	rm -rf out && ./node_modules/.bin/webpack --mode production

pack: prod
	vsce package

dev: src/fan.peg.js
	rm -rf out && ./node_modules/.bin/webpack --mode development --watch
