/**
 * 만족도 설문 QR 이미지 생성 (1회성, 결과 SVG 를 커밋한다).
 *
 *   npx tsx scripts/make-survey-qr.ts
 *
 * ⭐ QR 이 담는 주소는 **우리 도메인의 `/survey`** 다. 에어테이블 주소를 직접 담으면
 *    과목별 prefill 을 못 넣고, 폼을 다시 만드는 날 종이·화면에 박힌 QR 이 죽는다.
 *    서버가 그날 과목을 채워 넘기므로 QR 은 한 번 만들면 끝이다.
 *
 * ⭐ 런타임 의존성을 늘리지 않으려고 **빌드가 아니라 여기서** 만들어 파일로 둔다.
 *    (`qrcode` 는 devDependency 다)
 */

import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";

const url = process.env.PUBLIC_SITE_URL
  ? `${process.env.PUBLIC_SITE_URL}/survey`
  : "https://ltt-bnikorea.com/survey";

const out = path.join(process.cwd(), "client", "public", "survey-qr.svg");

const svg = await QRCode.toString(url, {
  type: "svg",
  errorCorrectionLevel: "M",
  margin: 1,
  color: { dark: "#111111", light: "#ffffff" },
});

fs.writeFileSync(out, svg, "utf8");
console.log(`✅ ${out}`);
console.log(`   담긴 주소 : ${url}`);
