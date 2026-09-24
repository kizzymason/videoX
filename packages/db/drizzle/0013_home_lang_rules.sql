-- 首页推荐：标题语种加权
--
-- 两件事：
-- 1. videos.title_lang —— 标题主语种，供推荐排序用（现算要按行跑一串正则，实测 300ms → 2.2s）
-- 2. home_recommend_lang_rules —— 后台可配的语种升降权，播种默认值
--
-- 回填是幂等的（带 IS NULL 条件），出错重跑不会重复写。

ALTER TABLE "videos" ADD COLUMN IF NOT EXISTS "title_lang" varchar(8);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "home_recommend_lang_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lang" varchar(8) NOT NULL,
	"direction" varchar(16) NOT NULL,
	"weight" double precision DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "home_recommend_lang_rules_lang_uq" ON "home_recommend_lang_rules" USING btree ("lang");
--> statement-breakpoint
INSERT INTO "home_recommend_lang_rules" ("lang", "direction", "weight") VALUES
	('zh', 'boost', 1.5),
	('zh-Hant', 'boost', 1.5),
	('ja', 'boost', 1.5),
	('en', 'penalty', 1)
ON CONFLICT ("lang") DO NOTHING;
--> statement-breakpoint
-- 标题语种回填。判定顺序必须与 packages/shared/src/text-lang.ts 的 detectTitleLang 一致：
-- 假名先于汉字（日文标题汉字 + 假名混排，先看汉字会整片判成中文），汉字里再分繁简。
-- 该列在视频标题写入时由 detectTitleLang 维护，这里只处理迁移前的存量。
UPDATE "videos"
   SET "title_lang" = CASE
     WHEN ("title" COLLATE "C") ~ '[ぁ-ゟ゠-ヿ]' THEN 'ja'
     WHEN ("title" COLLATE "C") ~ '[가-힣]' THEN 'ko'
     WHEN ("title" COLLATE "C") ~ '[ก-๛]' THEN 'th'
     WHEN ("title" COLLATE "C") ~ '[體愛萬這個們說來時為國開會對發與從經點區歲藝樂實還嗎麼樣東門見語話買賣聽讀寫覺謝讓認識記論談議課誰請問間關長聞靜頭題類風飛馬鳥魚龍龜雞鴨鵝豬貓爺媽師務員鐵銀銅鋼紙筆車產業習練戰變場無過現網錢頂順幾兒圖團學寶將應數斷構標權歡辭醫釋錯鎖錄鏡鐘陽陰際陳階隨隱難雲韓項預領願顧顯飄驚驗髮鬥鮮麗黃齊純織綠紅線緊緩縣總續賽購費質資責貴輕載轉較輛輩農邊進遠適選遺郵鄉]' THEN 'zh-Hant'
     WHEN ("title" COLLATE "C") ~ '[一-鿿]' THEN 'zh'
     WHEN ("title" COLLATE "C") ~ '[A-Za-z]' THEN 'en'
     ELSE NULL
   END
 WHERE "title_lang" IS NULL;
