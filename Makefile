.PHONY: dev test engine forge keeper typecheck

dev:
	npm run dev

typecheck:
	npx tsc --noEmit

engine:
	npx tsx --test src/lib/wolfpit/engine.test.ts src/lib/wolfpit/drills.test.ts

forge:
	forge test --root contracts

keeper:
	cargo test -p wolfpit-keeper

test: typecheck engine forge
	npx tsx --test src/lib/auth/gate-identity.test.ts src/lib/auth/rate-limit.server.test.ts src/lib/swap/safety.test.ts
