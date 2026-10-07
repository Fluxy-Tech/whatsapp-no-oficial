-- Black and white theme: purple columns (the old default) become black.
ALTER TABLE "pipeline_stage" ALTER COLUMN "color" SET DEFAULT '#171717';
UPDATE "pipeline_stage" SET "color" = '#171717' WHERE lower("color") = '#8b5cf6';
