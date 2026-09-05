-- notebooks.created_at / updated_at を秒 → ミリ秒へ変換する。
--
-- updated_at は楽観的ロック（PUT /api/notebooks/:id の expectedUpdatedAt）のトークンに使う。
-- 秒精度のままだと「最後の更新と同じ秒内に端末Aが保存 → 続けて端末Bが保存」で
-- 双方のトークンが一致してしまい、競合を検知できずに上書きが通る。
--
-- drizzle の mode: 'timestamp' と 'timestamp_ms' はどちらも SQL 上は integer なので
-- drizzle-kit は DDL の差分を出さない。既存行の変換はこの手書きマイグレーションで行う。
--
-- WHERE で秒とミリ秒を判別している（1e11 秒 = 西暦5138年、1e11 ミリ秒 = 1973年）ので、
-- 誤って二重に適用しても値が壊れない。
UPDATE `notebooks`
SET `created_at` = `created_at` * 1000
WHERE `created_at` < 100000000000;--> statement-breakpoint
UPDATE `notebooks`
SET `updated_at` = `updated_at` * 1000
WHERE `updated_at` < 100000000000;
