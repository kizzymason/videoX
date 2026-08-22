-- 旧默认巡检间隔是 60 分钟；改为 10 分钟。已手动改成其他值的配置不动。
UPDATE "collection_configs"
SET
  "value" = jsonb_set("value", '{healthCheckIntervalMinutes}', '10'::jsonb, true),
  "updated_at" = now()
WHERE "key" LIKE 'pool:%'
  AND COALESCE(("value"->>'healthCheckIntervalMinutes')::int, 60) = 60;
