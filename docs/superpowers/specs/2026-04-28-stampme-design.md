# stampme — Design Spec

**Date:** 2026-04-28
**Status:** Approved (with open assumptions — see §12)
**Owner:** Abdullah

---

## ١. Executive Summary

**stampme** هي منصّة B2B SaaS لإصدار كروت ولاء رقميّة (digital stamp cards) للمتاجر الصغيرة في السعوديّة، مدمجة مع Apple Wallet و Google Wallet. كلّ كرت يصدر بهويّة المتجر (whitelabel على مستوى الـ pass)، بينما stampme يبني طبقة الـ SaaS فوق PassKit API.

**القيمة الأساسيّة:** كافيه يفتح الموقع، يصمّم كرت ولاء بهويّته خلال ١٠ دقايق، يحصل على QR code يحطّه عند الكاشير، وعملاؤه يضيفون الكرت لـ wallet جوّالاتهم بنقرة. كلّ زيارة الكاشير يمسح، الكرت يتحدّث push تلقائياً.

**Positioning:** أرخص وأبسط من Foodics Loyalty، أعمق من Loyverse في تجربة الـ wallet، عربي-أوّلاً.

---

## ٢. Goals & Non-Goals

### Goals
- إطلاق MVP خلال ٦–٨ أسابيع
- الوصول إلى ٢٠ تاجر beta خلال أوّل ٣ شهور
- self-serve onboarding بالكامل (التاجر يبدأ بدون مكالمة sales)
- دعم RTL Arabic كامل + إنجليزي

### Non-Goals (في الـ MVP)
- Multi-location / فروع متعدّدة
- تكامل POS (Foodics, Loyverse, Square)
- WhatsApp Business API campaigns
- نظام نقاط (points) أو tiers
- Native mobile apps (PWA only)
- API عامّ للمطوّرين
- Multi-program لكلّ تاجر (تاجر واحد = كرت ولاء واحد)

---

## ٣. ICP & Market

| Attribute | Value |
|-----------|-------|
| Geography | السعوديّة (الرياض، جدّة، الدمام أوّلاً) |
| Merchant size | فرع واحد، ١–١٠ موظّفين |
| Verticals | كافيهات تخصّصيّة، صالونات حلاقة، عصائر، حلويات، مغاسل |
| Sales motion | Self-serve (volume play) |
| Target ACV | ٩٩–٢٤٩ ريال/شهر |
| Tech literacy | متوسّط — لازم الـ UX يكون بسيط جداً |

**المنافسون:**
- **Foodics Loyalty** — مدمج مع POS، أعلى سعر، تركيز على F&B الكبير
- **Loyverse** — مجّاني لكن تجربة wallet ضعيفة وإنجليزي فقط
- **Stamp Me / Loopy Loyalty (الدوليّة)** — ما عندهم arabic + payment rails السعوديّة

---

## ٤. User Flows

### ٤.١ Merchant Flow
1. يدخل `stampme.com` → Landing بالعربي
2. يسجّل: إيميل + جوّال + اسم المتجر → OTP عبر SMS
3. Onboarding wizard:
   - رفع اللوقو (PNG/SVG، حدّ أقصى ٢ MB)
   - اختيار اللون الأساسي
   - اختيار النوع (كافيه/صالون/...)
4. Card designer:
   - عدد الـ stamps (افتراضي ١٠)
   - نصّ الجائزة ("قهوة مجّانيّة")
   - معاينة مباشرة لكرت Apple Wallet + Google Wallet
5. تفعيل الاشتراك عبر HyperPay → استلام QR code + رابط مشاركة
6. يطبع QR / يشاركه عبر Instagram / WhatsApp

### ٤.٢ End-Customer Flow
1. يمسح QR في المتجر أو يضغط رابط
2. صفحة Enrollment بهويّة المتجر (لوقو + لون المتجر، لا ذكر لـ stampme)
3. يدخل رقم الجوّال فقط — لا تسجيل، لا OTP في الـ MVP
   - رقم الجوّال = identifier للتحليلات + استرجاع الكرت لو ضاع
   - الـ pass ID نفسه هو الـ source of truth (rate-limited على enrollment endpoint)
   - OTP للعميل → Phase 2 لو ظهرت إساءة استخدام
4. زرّ "Add to Apple Wallet" أو "Add to Google Wallet"
5. الكرت يُضاف فوراً ويظهر في wallet
6. كلّ زيارة → يفتح الكرت → الكاشير يمسح → stamp يُضاف
7. عند اكتمال الـ stamps → push notification + الكرت يتحدّث "Reward Ready"
8. يصرف الجائزة → الكرت يُعاد إلى ٠ تلقائياً

### ٤.٣ Staff (Cashier) Flow
1. يفتح `scan.stampme.com` على جوّال المتجر — PWA installable
2. يدخل PIN (٤ أرقام) واحد للمتجر كلّه في الـ MVP (per-staff PIN + audit trail → Phase 2)
3. زرّ كبير: "مسح كرت عميل"
4. يمسح QR من الـ wallet → شاشة:
   - رقم العميل (آخر ٤ خانات)
   - عدد الـ stamps الحالي (e.g. 7/10)
   - زرّ "أضف ختم" (primary) أو "اصرف الجائزة" (إذا مكتمل)
5. تأكيد بصوت + haptic + animation سريع

---

## ٥. MVP Scope

### داخل الـ MVP (Must-have)
- [x] Merchant signup + OTP عبر SMS
- [x] Onboarding wizard (٣ خطوات)
- [x] Card designer (قالب stamp card واحد — قابل للتخصيص في: عدد الـ stamps، نصّ الجائزة، اللوقو، اللون الأساسي. ليس قابل لتخصيص الـ layout أو الخط)
- [x] PassKit integration: program + pass template + pass issuance
- [x] Customer enrollment page (Apple + Google Wallet)
- [x] Staff scanner PWA مع PIN
- [x] Stamp + redemption flow
- [x] Merchant dashboard أساسي (٣ KPIs: passes issued, stamps today, rewards redeemed)
- [x] Billing عبر HyperPay (mada + Visa) — اشتراك شهري
- [x] Arabic + English (RTL/LTR)
- [x] Onboarding emails (Resend)

### خارج الـ MVP
- ❌ Multi-location
- ❌ POS integrations
- ❌ WhatsApp campaigns
- ❌ Points / tiers
- ❌ Custom domains
- ❌ Public API
- ❌ Native apps
- ❌ Multi-program per merchant
- ❌ Referral program

---

## ٦. Technical Architecture

### Stack
| Layer | Choice | Reasoning |
|-------|--------|-----------|
| Frontend + Backend | Next.js 15 (App Router) + TypeScript strict | Full-stack بـ deploy واحد |
| UI | Tailwind + shadcn/ui | RTL support جاهز |
| Database | Postgres (Neon serverless) + Prisma | Multi-tenant مع RLS |
| Auth | Clerk | OTP via SMS جاهز + organizations |
| Pass issuance | PassKit Members API (Node SDK) | الـ wallet plumbing |
| Payments | HyperPay | mada + Visa + 3DS في السعوديّة |
| File storage | Cloudflare R2 | أرخص من S3، مع CDN |
| Email | Resend | Arabic templates + deliverability ممتاز |
| SMS | Unifonic | KSA-native، أسعار جيّدة |
| Hosting | Vercel | Edge functions + zero DevOps |
| Validation | Zod | كلّ Route Handler + Server Action |
| Analytics | PostHog (cloud → self-host لاحقاً) | Funnels + replay |
| Monitoring | Sentry | Error tracking |

### High-level Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    stampme.com (Next.js 15)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ Marketing    │  │ Merchant     │  │ Staff Scanner    │  │
│  │ Landing (ar) │  │ Dashboard    │  │ PWA (mobile)     │  │
│  └──────────────┘  └──────────────┘  └──────────────────┘  │
└─────────────────────┬───────────────────────────────────────┘
                      │
              ┌───────┴────────┐
              │   API Routes   │  (Route Handlers + Server Actions)
              └───────┬────────┘
                      │
        ┌─────────────┼─────────────┬──────────────┐
        │             │             │              │
   ┌────▼────┐  ┌─────▼─────┐  ┌────▼─────┐  ┌────▼──────┐
   │ Postgres│  │  PassKit  │  │ HyperPay │  │  Resend   │
   │ (Neon)  │  │    API    │  │ (billing)│  │  (email)  │
   │ + Prisma│  │           │  │          │  │           │
   └─────────┘  └───────────┘  └──────────┘  └───────────┘
                      │
              ┌───────▼────────┐
              │ Apple Wallet + │
              │ Google Wallet  │
              └────────────────┘
```

### Multi-tenancy
- كلّ row في Postgres مفتاحه `merchantId`
- Row-Level Security (RLS) policies على Postgres
- في الـ app: middleware يحقن `merchantId` من Clerk session في كلّ query

### Security
- جميع المدخلات تمرّ على Zod schema قبل أي DB call
- Rate limiting على endpoints الـ public (enrollment, scanner) عبر Upstash Redis
- HMAC على روابط enrollment للتأكّد من المتجر صاحب الرابط
- لا API keys على الـ client — كلّ نداءات PassKit من server side
- Sentry بدون stack traces مكشوفة للمستخدم
- HTTPS فقط (Vercel + custom domain)
- CSP headers صارمة

> **Webhook authenticity:** HyperPay webhook payloads are AES-256-GCM **encrypted** (per oppwa.com docs), NOT HMAC-signed. Decryption key is `HYPERPAY_WEBHOOK_KEY_HEX`; the IV is supplied per-request via the `X-Initialization-Vector` header. Tampered auth tags must reject with 400. Clerk/PassKit webhooks do use HMAC (svix / shared-secret HMAC-SHA256) — don't conflate the two.

---

## ٧. Data Model (Prisma — تخطيط أوّلي)

```prisma
model Merchant {
  id            String   @id @default(cuid())
  name          String
  slug          String   @unique
  logoUrl       String?
  brandColor    String   @default("#000000")
  vertical      Vertical
  ownerEmail    String   @unique
  ownerPhone    String
  clerkUserId   String   @unique
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  subscription  Subscription?
  programs      LoyaltyProgram[]
  staffPins     StaffPin[]
}

model Subscription {
  id                  String   @id @default(cuid())
  merchantId          String   @unique
  plan                Plan
  status              SubscriptionStatus
  hyperpayRef         String?
  currentPeriodEnd    DateTime
  merchant            Merchant @relation(fields: [merchantId], references: [id])
}

model StaffPin {
  id          String   @id @default(cuid())
  merchantId  String
  pinHash     String
  label       String
  merchant    Merchant @relation(fields: [merchantId], references: [id])
}

model LoyaltyProgram {
  id                String   @id @default(cuid())
  merchantId        String
  name              String
  stampsRequired    Int      @default(10)
  rewardLabel       String
  passKitProgramId  String   @unique
  passes            Pass[]
  merchant          Merchant @relation(fields: [merchantId], references: [id])
}

model Pass {
  id              String   @id @default(cuid())
  programId       String
  customerPhone   String
  passKitPassId   String   @unique
  applePassUrl    String?
  googleWalletUrl String?
  stampsCount     Int      @default(0)
  status          PassStatus
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  events          StampEvent[]
  redemptions     RewardRedemption[]
  program         LoyaltyProgram @relation(fields: [programId], references: [id])

  @@index([programId, customerPhone])
}

model StampEvent {
  id          String   @id @default(cuid())
  passId      String
  staffPinId  String
  source      String   @default("scanner")
  createdAt   DateTime @default(now())
  pass        Pass     @relation(fields: [passId], references: [id])
}

model RewardRedemption {
  id          String   @id @default(cuid())
  passId      String
  staffPinId  String
  redeemedAt  DateTime @default(now())
  pass        Pass     @relation(fields: [passId], references: [id])
}

model PaymentMethod {
  id            String   @id @default(cuid())
  merchantId    String   @unique
  hyperpayRtId  String   @unique          // registration token from HyperPay
  last4         String
  brand         String                    // "MADA" | "VISA" | "MASTER"
  expMonth      Int
  expYear       Int
  holderName    String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  merchant      Merchant @relation(fields: [merchantId], references: [id])
}

model Charge {
  id              String        @id @default(cuid())
  merchantId      String
  subscriptionId  String?
  amountSar       Decimal       @db.Decimal(10, 2)   // pre-VAT
  vatSar          Decimal       @db.Decimal(10, 2)
  totalSar        Decimal       @db.Decimal(10, 2)   // amount + vat
  currency        String        @default("SAR")
  hyperpayRefId   String        @unique              // ndc / id from HyperPay
  status          ChargeStatus
  failureReason   String?
  invoicePdfKey   String?                            // R2 key
  createdAt       DateTime      @default(now())
  merchant        Merchant      @relation(fields: [merchantId], references: [id])
  subscription    Subscription? @relation(fields: [subscriptionId], references: [id])

  @@index([merchantId, createdAt(sort: Desc)])
  @@index([status])
}

enum Vertical { CAFE SALON JUICE BAKERY LAUNDRY OTHER }
enum Plan { STARTER GROWTH PRO }
enum SubscriptionStatus { TRIALING ACTIVE PAST_DUE CANCELED }
// PassStatus: REWARD_READY is set when stampsCount === stampsRequired (Plan 5);
// ISSUE_FAILED is set when PassKit issuance retries are exhausted (Plan 3).
enum PassStatus { ACTIVE REWARD_READY REDEEMED EXPIRED DELETED ISSUE_FAILED }
enum ChargeStatus { SUCCEEDED FAILED PENDING REFUNDED }
```

---

## ٨. PassKit Integration

### Lifecycle
1. **Merchant signup** → call `POST /programs` على PassKit → save `passKitProgramId`
2. **Card design save** → call `PUT /programs/{id}/templates` → upload لوقو + ألوان
3. **Customer enrollment** → call `POST /passes` → return `.pkpass` URL + Google Wallet link
4. **Stamp added** → call `PATCH /passes/{id}` → PassKit pushes update to device
5. **Webhook listener** على `/api/webhooks/passkit`:
   - `pass.installed` → log
   - `pass.removed` → mark as DELETED
   - `pass.viewed` → analytics

### Critical: Pricing & Margin
- PassKit يفوتر **per-pass** (سعر الباقات يبدأ من ~$50/شهر مع حدّ معيّن)
- لازم نتفاوض pricing tier قبل launch
- داخل التطبيق: نضع `stampsRequired ≤ 20` و حدّ أقصى ٣٠٠ pass للـ Starter (للمحافظة على هامش)
- Monitor: dashboard داخلي يعرض `passes_issued / month` لكلّ tier

### Risks
- 🔴 **PassKit pricing لم يُؤكّد بعد** — لو السعر $0.10/pass مع لا حدّ أدنى، الهامش يصير negative على Starter لو التاجر أصدر ٢٠٠٠+ pass
- 🟡 PassKit downtime → fallback؟ نخزّن requests في queue ونعيد لاحقاً
- 🟡 Vendor lock-in → لاحقاً ممكن نبني pass issuance بأنفسنا (Apple PassKit framework + Google Wallet API)

---

## ٩. Pricing

| Plan | Price (SAR/mo) | Passes/mo | Programs | Locations | Phase |
|------|----------------|-----------|----------|-----------|-------|
| Starter | 99 | 300 | 1 | 1 | **MVP** — يطلق في Phase 1 |
| Growth | 249 | 1,500 | 3 | 1 | Phase 2 — يحتاج multi-program |
| Pro | 499 | 5,000 | 10 | متعدّد | Phase 3 — يحتاج multi-location |

**ملاحظة:** الـ MVP يطلق بـ Starter فقط. Growth و Pro يفعّلان لمّا تُكتمل الـ features المطلوبة (multi-program → Phase 2، multi-location → Phase 3). هذا يحلّ التناقض مع §٢ Non-Goals.

- Free trial: ١٤ يوم بدون بطاقة
- Annual discount: شهرين مجّاناً (paid annually)
- Overage: 0.30 SAR لكل pass فوق الحد

---

## ١٠. Success Metrics

### Phase 1 (MVP, end of week 8)
- ✅ ٥ كافيهات beta معاهم passes نشطة
- ✅ ٥٠٠+ pass صادر
- ✅ Activation rate (signup → first pass issued) > 60%
- ✅ Time-to-first-pass < 15 دقيقة

### Phase 2 (month 4)
- ٢٠ تاجر دافع
- ٥٬٠٠٠ pass نشط
- MRR > ٥٬٠٠٠ ريال
- Churn < 8% شهرياً

### Phase 3 (month 6+)
- ١٠٠ تاجر دافع
- MRR > ٢٥٬٠٠٠ ريال
- NPS > 40

---

## ١١. Roadmap

### Phase 1 — MVP (٦–٨ أسابيع)
- W1–2: Setup (Next.js, Prisma, Clerk, Vercel) + Landing عربي
- W3–4: PassKit integration + first working pass على test merchant
- W5: Card designer + onboarding wizard
- W6: Staff scanner PWA + كامل stamp/redemption flow
- W7: HyperPay billing + plans
- W8: Dashboard + analytics + QA + launch beta على ٥ كافيهات

### Phase 2 — Polish & Growth (شهر ٣–٤)
- ٥–١٠ قوالب كروت جاهزة
- تحليلات متقدّمة (cohort retention)
- SMS templates للعملاء (welcome, reminder, reward ready)
- Onboarding videos بالعربي
- Public testimonials + case studies

### Phase 3 — Scale (شهر ٥+)
- Multi-location support
- Foodics POS integration
- WhatsApp Business API campaigns (الـ wedge الكبير)
- Points / tiers system
- Public API

---

## ١٢. Open Assumptions (لازم تأكيد قبل الـ implementation)

| # | Assumption | Default in Spec | Risk if Wrong |
|---|-----------|-----------------|---------------|
| 1 | PassKit pricing tier محسوم ويسمح بهامش معقول | غير مؤكّد — افترضنا ~$50/mo base | 🔴 الهامش negative — يجب تأكيد قبل أي كود |
| 2 | الفريق = شخص واحد (Abdullah) | فرد واحد | 🟡 timeline ٦–٨ أسابيع قد يطول لـ ١٠–١٢ |
| 3 | الميزانية لـ launch | غير محدّدة | 🟡 يحدّد إذا نستخدم paid tools (Clerk/Sentry/PostHog) أم نسخ مجّانيّة |
| 4 | عند ٥ كافيهات beta جاهزين للتجربة | غير مؤكّد | 🟡 بدون beta merchants لا feedback في Phase 1 |
| 5 | اعتماد HyperPay كـ payment processor | افتراضي | 🟢 ممكن استبدال بـ Tap بدون تأثير على architecture |

---

## ١٣. Out-of-Scope Risks

- **Apple Developer Account** للتاجر: PassKit يدير الـ certificates، لكن لو احتجنا custom branding أعمق لاحقاً، كلّ تاجر يحتاج Apple Developer Account ($99/yr)
- **App Store Review:** PWA لا يحتاج، لكن لو سوّينا native app لاحقاً، Apple قد يرفض apps ولاء بدون فائدة كبيرة
- **VAT في السعوديّة:** ١٥% لازم تُضاف على الفواتير، HyperPay يدعم ZATCA e-invoicing
- **PDPL (KSA):** قانون حماية البيانات السعودي — رقم جوال العميل = personal data → لازم retention policy + privacy notice

---

## Sign-off

- [x] Product approved by Abdullah (2026-04-28)
- [ ] PassKit pricing confirmed
- [ ] Beta merchants identified
- [ ] Implementation plan written (next step)
