/**
 * The coupon check: does a student already have a coupon, so the 30% is not
 * theirs (admin rebuild 2, D5; every student answered since T-122,
 * 2026-10-21; the owner's rule as he put it since T-122's third fix round,
 * 2026-10-22, and its fourth and fifth, the same day).
 *
 * THE OWNER'S RULE (2026-10-21): "they should not be able to apply for the
 * code if they have a coupon already ... If they paid less than 97, most
 * likely they have a coupon. I don't want to even let them apply for the
 * discount if they have a code already." Within the 30% window a student has
 * made one course payment, rarely two. judgeStudentDiscount says it in this
 * order, the codes first and the price second:
 *   1. A CODE ON A MEMBERSHIP. Any course membership the check reads (the
 *      one on file, every one found through the student's Whop user that
 *      grants access, and since T-122's fourth fix round every one found
 *      there that no longer does, canceled or expired, read for its code
 *      alone) that names a promo code other than this student's own 30%
 *      code is a coupon, whatever its renewal price and whether its price or
 *      plan reads. A one-month code keeps its id on the membership once it
 *      is used (the live probe of 2026-10-20: a used ECOM30 and a used
 *      one-month 50% code both renew at 97.00), so a student who came in on
 *      one still shows it there, and a student who came in on a 100% first
 *      month and bought again at 97.00 on a new membership shows it on the
 *      old one. A membership of another product (its `product_id`, which
 *      Whop's schema requires, not one of the course's) is passed over since
 *      the fifth fix round, so that product's own code never refuses a
 *      course student.
 *   2. A CODE ON A PAYMENT, OR A DISCOUNT ONE SHOWS. Any course payment of
 *      the student that names a promo code other than this student's own
 *      30% code is a coupon, whatever its totals and whether they read: the
 *      $0 ones too (a 100% code's checkout), which the pinned payments list
 *      gives with the rest (first-payment.ts fetchCoursePayments). Since the
 *      fifth fix round so is any course payment naming no code whose price
 *      (step 3's: its total less a tax added on top) is below its subtotal,
 *      Whop's "price before discounts" (discountWithoutCode): a 0.00
 *      checkout of a 97.00 subtotal, 873.00 of 970.00, EUR 44.95 of 89.90,
 *      in whatever currency, refunded or not; a charge for a change to the
 *      subscription (`billing_reason` "subscription_update") excepted. This
 *      student's own 30% is named on its payment, so it stays no coupon.
 *   3. THE PRICE, only when no code or discount shows anywhere, of the
 *      student's FIRST real course payment alone ("if they paid less than
 *      97"): the one students.first_paid_at names, else the earliest real
 *      course payment the list gives (firstRealPayment), and among real
 *      payments at that moment, since the fifth fix round, the checkout
 *      (`billing_reason` "subscription_create"), else the highest price. A
 *      real payment is paid, above 0, not refunded or lost in a dispute
 *      (first-payment.ts THE RULE), and names its buyer. Naming no code, it
 *      is a coupon when its price is under 97.00, the price being its total
 *      less a tax added on top (`tax_behavior` exactly "exclusive"; with any
 *      other behaviour, or none, the total stands); the price judges it only
 *      in dollars (codes alone judge another currency) and when it is no
 *      charge for a change to the subscription (`billing_reason`
 *      "subscription_update"). A later charge never refuses a student by its
 *      price: a manual charge, an add-on (`one_time`), a plan change's 12.34
 *      after a 97.00.
 * THIS STUDENT'S OWN 30% CODE is never a coupon (isOwnThirtyCode): the Whop
 * promo id stored on their own approved or applied request; or, only beside
 * such a request, a code named, the case not minded, exactly as the approve
 * route names this student's (teamThirtyCodeFor: ECOM30- and the first 6
 * characters of their id, upper-cased), since two students' ids can share
 * their first 6 characters. Any other ECOM30 code is a coupon: a public code
 * named ECOM30, one named Ecom30Friends, another student's ECOM30-ABC123 or
 * ECOM30-5A1B2C used at checkout. The 30% page still reads every ECOM30 code
 * as the team's, for its display (isThirtyCode in thirty-view.ts).
 * Until the third fix round step 1 asked the code to take money off the next
 * renewal (THE RULE below), the memberships found through the Whop user were
 * read only when the one on file gave no answer or was on a free plan, every
 * ECOM30 code was the team's, a payment's code counted only when it took
 * money off, no $0 payment was read, and the price also judged a payment
 * naming a code, a plan change's charge and, at its usd_total's rate, a
 * payment in another currency. So a 100% first-month code, a first-year 10%
 * whose payment names no code, a EUR payment naming no code beside welcome50
 * on the membership, a second membership on a 100% code and a public code
 * named ECOM30 each let a student who came in on a code apply, while a plan
 * change's charge, or a EUR 89.90 that converted to 96.99 dollars, refused a
 * student who had none.
 * Until the fourth fix round a course membership that no longer grants
 * access was never read, so a 100% first month on a canceled membership,
 * the student back at 97.00 on a new one, passed; the price judged every
 * real course payment, so a 10.00 manual charge or a 47.00 add-on after a
 * 97.00 first payment refused a student who came in at full price; the
 * name of this student's own code counted with no request of theirs, so
 * another student's code whose id shares 6 characters passed; and a v2 list
 * in another shape, holding another user's row or running past 4 pages, or
 * a membership read answering a body that could not be read, read as no
 * code.
 * Until the fifth fix round a stored "no coupon" with a step's word as its
 * source answered whichever build wrote it; a student whose row could not
 * be read was answered by a stored "no coupon" of any membership; a
 * membership read answering an object of another id, or naming no code
 * field, read as no code; a payment naming no buyer was left out; a
 * membership of another product on file was read for its code; a payment
 * naming no code that came to less than its subtotal was judged by the price
 * alone (only a dollar first payment under 97.00 refused); the price's first
 * payment was the first listed at its moment, so a 10.00 add-on listed
 * before the 97.00 checkout refused; and the ended memberships were read one
 * after the other, so a student with two of them went past the request
 * routes' limits when Whop took 2 seconds an answer.
 *
 * THE RULE, the membership on its own (readMembershipDiscount: the 30% page's
 * read of its Approved rows, and the prices a stored row holds): a promo code
 * that still applies to the next renewal. Whop says so on the membership
 * itself, read from v1 with Api-Version-Date pinned to 2026-10-15-1:
 * `renewal_price` is "what the next renewal charges, after any promo code
 * that still applies", so the membership is discounted when it carries a
 * promo code (`promo_code_id`) and its `renewal_price` is below its plan's
 * renewal price (the live probe of 2026-10-20: 165 live memberships on the
 * forever 10% "evolve10" renew at 87.30 on the 97.00 plan). A member kept on
 * an older, lower price with no code on the membership is not discounted.
 * Prices are compared in cents. Since the third fix round it no longer
 * decides the coupon: a used code renewing at full price is a coupon, and
 * this student's own 30% still on the next renewal is not.
 *
 * WHICH MEMBERSHIPS AND PAYMENTS (T-122, 2026-10-21). The first live dry run
 * of the cron (production, 2026-10-21, read only) could not read 46 of 290
 * students: 22 hold a payment's id (pay_...) where the membership's belongs,
 * written by the webhook before login-1 fixed it, and 24 memberships came
 * back with no plan or no renewal price. Every student now ends in a yes or
 * a no, read in this order, the first coupon answering:
 *   - The membership on file (`students.whop_membership_id`): a code on it
 *     is source "membership". An id that is not a membership's, one Whop
 *     does not know (a 404, or another 4xx for that one id), or since the
 *     fifth fix round a membership of another product, is passed over.
 *   - Every course membership of the student found through their Whop user
 *     (findCourseMemberships), whatever the one on file said (since the
 *     third fix round): a code on any one is source "user", the row naming
 *     that membership. First those that grant access, active before
 *     past_due, then the newest, read one after the other; then, since the
 *     fourth fix round, those that no longer do (canceled, expired), the
 *     newest first, read for a code alone and never settled on, and since
 *     the fifth all at the same time. The course is the products
 *     WHOP_PRODUCT_ID names, less ETfB and Apex (courseProductIds); the
 *     setting names the course alone since 2026-10-20, and with none named
 *     nothing is read (no_course_product). The list is v2's, by
 *     user_id, the read the login's self-heal and the webhook make
 *     (fetchActiveMembershipForUser in whop-members.ts), with every row's
 *     user checked. Whop says v2 stops working on 13 November 2026; its v1
 *     successor in the reference for 2026-10-15-1 is GET /api/v1/memberships
 *     with user_id and product_id (task T-113), never tried here.
 *   - Every course payment (fetchCoursePayments), read at the same time as
 *     the user's list since the fourth fix round, one naming no buyer too
 *     since the fifth: a code on one, or a discount one shows with no code
 *     named, is source "payment", the row naming that payment's membership
 *     (when it names none, the membership the check settled on) and its
 *     code; with neither anywhere, the price of the first real one (step 3),
 *     the same source.
 * With no coupon the check settles on a membership: the one on file when it
 * read a renewal price above 0, else the first found through the user that
 * does, else the first found there that renews at 0 (a free plan on file
 * hands over to a paid one found there, as the sync and the webhook put the
 * newest membership that grants access on file). Paid or free is the
 * membership's own renewal price since the fourth fix round: a membership
 * naming no code has its plan read no more, and its row holds no plan price;
 * since the review of 2026-10-26 the plan is read again for one whose renewal
 * price does not read, a one-time plan or one renewing at 0 making it free.
 * Since that review a membership that no longer grants access (its status
 * canceled or expired, accessOf), the one on file too, is never settled on,
 * and a membership v2 lists that v1 does not know is passed over.
 * Since 2026-10-26 a no coupon needs a real course payment beside a paid plan
 * (THE PAID PLAN AND THE PAYMENT, below): the paid membership settled on
 * answers with its own source; with none settled on, when a membership that
 * grants access gave no renewal price and its plan neither said it is free
 * nor read, or the user's list answered a 404 or another 4xx, the
 * first real payment answers (source "payment"; the newest until the fourth
 * fix round); every other no coupon is unpaid (source "payment"). Until then
 * the settled membership answered whatever the payments, and with none the
 * first real payment, a free one settled on only beside a real payment.
 *
 * NO ANSWER. A check gives no yes or no only when Whop does not answer: no
 * connection, a 5xx, a 429 after its two retries, nothing within the time
 * limits; or refuses the key (401, 403); or answers the payments or the
 * user's memberships in a way this code cannot judge (another shape, a row
 * of another user, more pages than one user has: bad_page, filter_ignored,
 * too_many_pages; the user's list since the fourth fix round, when each read
 * as no memberships); or answers a membership read with a body it cannot
 * read (bad_shape: not JSON, or JSON that is no object, an array or a
 * string, since the fourth fix round; and since the fifth an object whose
 * `id` is not the membership asked for, a wrapped body or `{}` among them,
 * or one naming neither `promo_code_id` nor `promo_code`, the field Whop's
 * schema requires on every membership, null when no code applies: each read
 * as a membership naming no code until then, and the payments decided). Or
 * when the deployment cannot ask: no key, no course product in
 * WHOP_PRODUCT_ID, a student with no Whop user (the column is NOT NULL).
 * Then the caller writes nothing for that student, and the request routes
 * refuse with "We couldn't check your membership just now. Try again in a
 * minute." unless a stored row answers (WHO READS IT). A 404 or another 4xx
 * for the user's list (a 410 once v2 is gone) is no answer either way: the
 * check goes on without the list, by the membership on file and the
 * payments, and the cron counts those students (user_list_unusable), so a
 * list that stopped answering shows.
 *
 * THE V2 SHUTDOWN (T-122's fifth fix round, until the list moves to v1,
 * task T-113). A no coupon judged without the user's list (a 404 or another
 * 4xx for it, a 410 once Whop turns v2 off on 13 November 2026) can miss a
 * code on a second, canceled or expired course membership that no payment
 * shows. The student gets that live answer all the same, but its row is
 * stored with no source, so the stored fallback never answers with it. An
 * unpaid answer is stamped all the same since 2026-10-26: it refuses whatever
 * a code would have said.
 *
 * THE READS, all paced at 4 requests a second start to start, a 429 waited
 * out (Whop's "Try again in N seconds", or 15 s, at most 30) and retried
 * twice, as first-payment.ts reads payments; the v1 reads pinned to
 * 2026-10-15-1:
 *   GET /api/v1/memberships/{id}   id, promo_code_id, renewal_price, plan_id,
 *                                  since the fifth fix round product_id, and
 *                                  since the review of 2026-10-26 status
 *                                  (and valid, should Whop give it)
 *   GET /api/v1/plans/{id}         the plan's renewal_price, and since the
 *                                  review of 2026-10-26 its plan_type, once
 *                                  per plan per run (the cache); since the
 *                                  fourth fix round only for a membership
 *                                  naming a code (for a coupon's row and the
 *                                  student's own 30%), and since that review
 *                                  for one naming none whose renewal price
 *                                  does not read (free, or not). The
 *                                  memberships found through the user are no
 *                                  longer put in order by their plans. The
 *                                  reference for 2026-10-15-1
 *                                  lists plans as variants (GET
 *                                  /api/v1/variants/{id}), and /plans is
 *                                  deprecated there and still answers (API
 *                                  Versions; the workspace's facts_whop.md)
 *   GET /api/v1/promo_codes/{id}   the code's name (`code`), once per code
 *                                  per run; a failed name read leaves the
 *                                  name out, and the code is then this
 *                                  student's own only by its promo id
 *   GET /api/v2/memberships?user_id=&per=50&page=   at most 4 pages
 *   GET /api/v1/payments?user_id=&status=paid&first=100   every page
 * The membership on file is read first; the user's list and the payments
 * then at the same time (since the fourth fix round), and the memberships
 * the list names after them: those that grant access one after the other,
 * then those that no longer do all at once (since the fifth fix round; one
 * after the other until then). A student with no code anywhere and one
 * course membership costs 3 reads, two answers' time (the membership, then
 * the list beside the payments; 4 in a row until then, so a Whop slower than
 * 2 seconds an answer gave the request routes' 503); with ended course
 * memberships beside it, one answer's time more, however many; one with a
 * code on the membership on file 3 (the membership, its plan, the code's
 * name); one whose membership on file names no code and gives no renewal
 * price, one read and one answer's time more for its plan (since the review
 * of 2026-10-26), once per plan per run.
 * Every field is read in either shape Whop has used: a price as "87.30", a
 * number or { amount }, an id as a string or { id }.
 *
 * WHERE IT IS STORED. student_membership_discounts (migration v111), one row
 * per student, written by the service role only:
 *   - the cron route /api/cron/refresh-membership-discounts every 2 hours
 *     (refreshMembershipDiscounts below), for the students whose 30% window
 *     is still open (discountWindowOpen: a first payment from
 *     DISCOUNT_ELIGIBLE_FROM and a deadline not past), active or past_due,
 *     and every student holding a pending request whatever their window or
 *     membership, all with no approved or applied request. The window since
 *     the render review's fix round (until then every student who first paid
 *     from 1 October, a list that grew with each new student while their
 *     windows closed); the pending requests since its second round (the
 *     first left them out once their window closed, and a stale answer then
 *     held the 30% page's row to Reject);
 *   - the request routes and the approve route, after a live read
 *     (checkMembershipDiscount below), so the map and the admin page catch
 *     up at their next read;
 *   - "Check Whop again" on the 30% page (POST
 *     /api/admin/thirty/check-coupon), the same live read for one student
 *     whose pending request the stored row refuses.
 * `discounted` is the check's answer: a coupon. `whop_membership_id` is the
 * membership judged: the one carrying the code; for a payment on a coupon
 * that payment's own, else the membership the check settled on; for a
 * "payment" row with no coupon the membership whose read gave no price, else
 * the first real payment's own (null when it names none; the newest
 * payment's until the fourth fix round), and for an unpaid answer (THE PAID
 * PLAN AND THE PAYMENT, since 2026-10-26) the membership on file when it is
 * one (so the answer counts while it stays on file), else the one whose read
 * gave no price, else the free one settled on. `source` (v113) is THE RULE
 * STAMP: the step that answered with the rule's version before it
 * ("r6-membership", "r6-user", "r6-payment", storedSourceOf; "r5-..." from
 * T-122's fifth fix round until the paid plan and the payment; the step's
 * word alone until the fifth fix round), or null on a no coupon judged
 * without the user's list (THE V2 SHUTDOWN), but for an unpaid answer, which
 * is stamped all the same since 2026-10-26 and which the stored fallback
 * answers with; `source_checked_at` (v113) is the `checked_at` of the write
 * that set it. A database without v113 refuses a row that carries them, and
 * since the review of 2026-10-26 so does one whose copy of v113 refuses this
 * rule's stamp (refusesThisStamp: the copy in production's tree takes r5
 * alone), so the row is written again without them. On a membership row the
 * prices are the membership's renewal and its plan's (each empty when it did
 * not read; the plan's always empty on a membership naming no code since the
 * fourth fix round, which reads no plan for it).
 * On a "payment" row `renewal_price` is the price the payment came to after
 * discounts (its total less any tax added on top, in its own currency; empty
 * when its total does not read) and `plan_renewal_price` what it is set
 * against: its subtotal when it names a code or shows a discount naming
 * none, 97.00 when the price judged it, else empty (both empty, with no
 * code, on an unpaid answer); the code is the payment's, when it names one.
 * A stored row counts only for the membership it was read from
 * (storedRowApplies): a student who moved to another membership since has no
 * stored answer. When the id on file is not a membership's, there is nothing
 * on file to compare, and the student's row counts.
 *
 * WHO READS IT. The request routes and the approve route check live, then
 * fall back to the stored row (checkMembershipDiscount). A stored coupon
 * answers whoever wrote it. A stored "no coupon" answers only when this rule
 * wrote it and no other writer wrote over it since (stampedByThisRule, since
 * T-122's fifth fix round): its `source` carries this rule's version (r6
 * since 2026-10-26: a row of the r5 rule, which production's build writes,
 * stored a trial or a refunded student's paid membership as no coupon, which
 * this rule refuses) and its
 * `source_checked_at` is its `checked_at`; and, since the fourth fix round,
 * only when it names no code or this student's own 30% by the promo id on
 * their own approved or applied request (storedNoCouponAnswers). The builds
 * of the rounds before wrote a step's word alone, which v113's check refuses
 * (it takes this rule's three values and null): their write fails, they log
 * it and keep their live answer (a cron of theirs stops at its first write
 * and answers 500), so they store nothing. A build from before T-122 writes no `source`: a row it
 * adds has none, and its upsert of a row this rule wrote keeps the stamp
 * (PostgREST's upsert sets the payload's columns alone) with a new
 * `checked_at`, so the two times differ and the row is no answer. Until the
 * fifth fix round a step's word answered from any build that wrote one,
 * among them the world-engine preview, which stores a student who came in on
 * welcome50 as no coupon. A row with no source was written before v113, by
 * the rule production's cron has run since 2026-10-21, which let some coupon
 * holders through; it is no answer, so the request routes give their 503.
 * On a database without v113 no source can be read, so a stored "no coupon"
 * never answers there, and the writers write without it as before. When the
 * student's own row cannot be read (student_unread), so the membership on
 * file is not known, only a stored coupon answers, since the fifth fix
 * round, and a line says so. With no answer from Whop or the stored row
 * (source "none"), the request routes, since the owner's review of
 * 2026-10-21, write nothing and ask the student to try again in a minute
 * (membershipUncheckedRefusal in discount-server.ts); the approve route,
 * since the fourth fix round, refuses the normal Approve too
 * (couponUncheckedApprovalRefusal), and Approve anyway, a founder's or an
 * admin's, still goes on (it went on for everyone until then). The map reads
 * the stored flag through /api/student/data. The admin's 30% page reads the
 * stored rows.
 *
 * THE PAID PLAN AND THE PAYMENT (the owner, 2026-10-26, his answers to the
 * review of this rule: "They shouldn't be able to apply. If they don't have a
 * payment and a paid plan - no applying to 30% off. Can't even give it to them
 * so there's no point."; of a course membership with no real payment, "They
 * shouldn't be able to apply either yes"; of the free plan, keep refusing it).
 * With no coupon, the check says whether Whop shows BOTH a real course
 * payment (firstRealPayment: paid, above 0, not refunded in full or lost in a
 * dispute, naming its buyer) AND a course membership on a paid plan (one
 * that grants access, active, trialing or past_due, renewing above 0, settled
 * on: the one on file, or one found through the Whop user). Without both the
 * student is UNPAID (judgeStudentDiscount's `noRealPayment` and `noPaidPlan`,
 * CouponCheck.unpaid): a payment for another product alone (ETfB, Apex), a
 * free plan (renewing at 0, or since the review of 2026-10-26 a one-time
 * plan or one renewing at 0 when the membership gives no renewal price), a
 * trial whose checkout was $0, a past_due membership whose only charge
 * failed, a full refund, a canceled or expired course membership (on file
 * too, since that review), no course membership at all. The plan is not
 * known, and the payment decides, when no paid membership is settled on but
 * a membership that grants access gave no renewal price and its plan
 * neither said it is free nor read (a plan renewing above 0 among them: a
 * membership set to cancel most likely reads so, the docs giving no renewal
 * price for a membership that does not renew), or the user's list answered a
 * 404 or another 4xx: a real payer whose membership gives no price, or whose
 * memberships v2 does not list, is never refused for it. An unpaid answer is
 * stored as a "payment" row with no coupon, no code and no price
 * (rowShowsUnpaid), naming the membership on file when it is one, so it
 * counts while that stays on file (storedRowApplies), else the one whose read
 * gave no price, else the free one; every other answer holds a price, the
 * paid membership's renewal or the real payment's own. It carries THE RULE
 * STAMP even when the user's list was not read: with no real course payment
 * the list cannot change the answer, since the payments are read whole, and
 * with the list unread no student is unpaid for the plan. Both request routes
 * refuse an unpaid student before writing (unpaidRefusal in
 * discount-server.ts, one sentence for every case: "The 30% needs a paid
 * course plan and a payment that went through."), the normal Approve refuses
 * with code "rule" (UNPAID_APPROVAL; Approve anyway passes), the 30% page's
 * verdict says it from the stored row (thirty-view.ts couponOf), and the map's
 * 30% panel says the student's sentence with no Apply, from the same row
 * (/api/student/data's membershipUnpaid, discount.ts "unpaid", while the
 * window is open).
 * Until these answers a course membership renewing above 0 stood in for a
 * payment it did not show (trialing at $0, past_due after a failed first
 * charge, canceled or expired after a full refund each passed), a free plan
 * beside a real payment passed, the refusal said "We can't see your first
 * payment yet." to a student who had paid for another product, and the map
 * offered Apply; until the review before them (2026-10-26, the owner's
 * applicant: "he never had a membership. I see one payment, but it has failed
 * ... he watched the course even though he never paid") only the cron counted
 * a student with no real payment (no_real_payment), and one whose first_paid_at
 * was filled before the first-paid fix could apply and be approved. Until the
 * review of these answers' build (the same day) the membership on file was
 * the paid plan whatever its status, so a canceled or expired one renewing
 * above 0 beside a real payment passed; a free plan whose renewal price read
 * empty, or one beside a membership v2 lists and v1 does not know, let the
 * payment decide; and a past_due membership v2 marks not valid was never
 * settled on, though the same one on file was.
 * STILL OPEN: once v2's list answers a 404 or a 410 for everyone (13 November
 * 2026, until the list moves to v1, task T-113) the payment decides whenever
 * no paid membership is settled on, so a canceled course membership on file
 * beside a real payment passes then. A membership set to cancel at the end of
 * its period still grants access, and passes while its renewal price reads
 * above 0 or its plan renews above 0 (whether it should is the owner's call).
 * Whether Whop's own answers have these shapes (a status on the v1 read, a
 * null renewal price on a one-time membership, plan_type on a plan) was read
 * from its docs and the saved reads, not from production.
 *
 * No answer names a student, an email or a Whop id: student ids only. A
 * failure comes back as a kind, never as Whop's words.
 *
 * THE 30% THAT APPLIES ITSELF (T-137) adds the attach and the reads around
 * it, below readMembershipDiscount: applyWhopPromoCode (POST
 * /api/v1/memberships/{id}/apply_promo_code, by the code's name, a fresh
 * Idempotency-Key each call), readMembershipForApply (the membership's status,
 * code, product and renewal price), findThirtyCodeByName (the company's codes
 * made after a time, by name) and findMembershipsWithCode (the memberships
 * holding a code), all pinned. The attach's refusal carries Whop's
 * error.message, cut to 300 characters, for the team's 30% page: the one
 * answer here that does. The check's answer names the membership it was read
 * from (CouponCheck.membershipId), where the code goes first, and
 * `store: false` reads without storing.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { discountWindowOpen, earliestOpenFirstPayment } from "./discount.ts";
import { fetchAllRowsPaginated } from "./supabase-pagination.ts";
import { fetchCoursePayments, waitAfter429Ms, type CoursePayment } from "./first-payment.ts";
import { mapStatus, toIso } from "./whop-members.ts";
import { ETFB_PRODUCT_ID, TEAM_SEAT_PRODUCT_ID } from "./whop-products.ts";

export const WHOP_API_V1 = "https://api.whop.com/api/v1";
/** v2's membership list, which takes user_id: the login's self-heal reads a user's memberships there (whop-members.ts). */
export const WHOP_API_V2 = "https://api.whop.com/api/v2";
/** The membership shape with promo_code_id and renewal_price. Plans and promo codes are read with the same pin. */
export const WHOP_DISCOUNT_VERSION = "2026-10-15-1";
export const MEMBERSHIP_DISCOUNTS_TABLE = "student_membership_discounts";
/**
 * v111's columns. v113's `source` and `source_checked_at` are written, and
 * read only by the request routes' fallback (checkMembershipDiscount), which
 * reads again without them on a database without v113, so every read still
 * answers there.
 */
export const MEMBERSHIP_DISCOUNT_COLUMNS =
  "student_id, whop_membership_id, promo_code_id, promo_code, renewal_price, plan_renewal_price, discounted, checked_at";
/** The course's monthly price: a real payment in dollars under it, naming no code, is most likely on a coupon (the owner's rule, step 3). */
export const FULL_PRICE = 97;
/** The billing reason of a charge for a change to the subscription (a plan change's proration): neither the price (step 3) nor its subtotal (step 2) judges it. */
export const PLAN_CHANGE_REASON = "subscription_update";
/** The billing reason of a first purchase: among real payments at the first payment's moment, the price judges this one (firstRealPayment). */
export const CHECKOUT_REASON = "subscription_create";

/** 4 Whop requests a second, start to start, as the payment reads: the logins share the key. */
const WHOP_GAP_MS = 250;
const RETRIES_AFTER_429 = 2;
/** A request route waits this long for Whop at most before it uses the stored row. */
const ROUTE_START_BUDGET_MS = 6_000;
const ROUTE_ANSWER_BUDGET_MS = 8_000;
/** The cron: no Whop request starts after 240 s, none is waited on past 285 s (maxDuration is 300). */
export const REFRESH_START_BUDGET_MS = 240_000;
export const REFRESH_ANSWER_BUDGET_MS = 285_000;
/** The cron writes its rows this many at a time, so a run that stops early keeps what it read. */
const WRITE_CHUNK = 25;
const BATCH = 100;
/** The memberships found through the Whop user: at most this many pages of one user's memberships (50 a page); more is not one user's list. */
const USER_PAGES_MAX = 4;

/** The step that answered (WHICH MEMBERSHIPS AND PAYMENTS, above): the membership on file, a course membership found through the Whop user, a course payment. */
export type DiscountSource = "membership" | "user" | "payment";
export const DISCOUNT_SOURCES: readonly DiscountSource[] = ["membership", "user", "payment"];

/**
 * THE RULE STAMP (T-122's fifth fix round): the version of this rule, which
 * every `source` it stores carries before the step ("r6-membership"). A rule
 * that changes again takes the next version, in v113's check and here at
 * once. r6 since the owner's paid plan and payment (2026-10-26, the header):
 * the r5 rule, which production's build runs, stored a no coupon for a paid
 * membership with no real payment (a trial at $0, a full refund) and for a
 * free plan beside a payment, both of which this rule refuses, so an r5 row
 * is an older rule's here and never answers as a no coupon. v113's check takes
 * the r5 and the r6 values and null, so production's r5 build keeps storing
 * its rows until this one replaces it; the steps' words alone (the rounds
 * before the fifth) it refuses. The review of the same day's fixes (the
 * status of the membership on file, the plan of a membership with no renewal
 * price, a listed membership v1 does not know) are r6 too: no build writing
 * r6 had been deployed and v113 was pasted nowhere, so no row carried an r6
 * stamp of the rule before them. A copy of v113 taking the
 * r5 values alone (production's tree) refuses this stamp: the rows are then
 * written without it (upsertDiscountRows, refusesThisStamp) until this tree's
 * copy is pasted over it.
 */
export const RULE_VERSION = "r6";
export type StoredSource = "r6-membership" | "r6-user" | "r6-payment";
export const STORED_SOURCES: readonly StoredSource[] = ["r6-membership", "r6-user", "r6-payment"];

/** The `source` this rule stores for a step. */
export function storedSourceOf(step: DiscountSource): StoredSource {
  return `${RULE_VERSION}-${step}` as StoredSource;
}

/** Whether a stored `source` carries this rule's version (WHO READS IT). */
export function isCurrentRuleSource(value: unknown): value is StoredSource {
  return typeof value === "string" && (STORED_SOURCES as readonly string[]).includes(value);
}

/** An instant as a stored timestamp gives it back, or NaN when it does not read. */
function instantOf(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) : NaN;
}

/**
 * Whether this rule wrote the stored row and nothing wrote over it since
 * (WHO READS IT, the header): its `source` carries this rule's version, and
 * its `source_checked_at`, set by the same write, is its `checked_at`. A
 * build from before T-122 writes neither, so its upsert over a row this rule
 * wrote keeps the stamp with a new `checked_at`, and the two differ.
 */
export function stampedByThisRule(row: { source?: unknown; source_checked_at?: unknown; checked_at?: unknown }): boolean {
  if (!isCurrentRuleSource(row.source)) return false;
  const stamped = instantOf(row.source_checked_at);
  return Number.isFinite(stamped) && stamped === instantOf(row.checked_at);
}

/** One row of student_membership_discounts. Prices as Whop gives them. */
export interface MembershipDiscountRow {
  student_id: string;
  whop_membership_id: string | null;
  promo_code_id: string | null;
  /** The code's name ("evolve10"); null when there is no code or its name could not be read. */
  promo_code: string | null;
  renewal_price: number | null;
  plan_renewal_price: number | null;
  discounted: boolean;
  checked_at: string;
  /**
   * v113: THE RULE STAMP, the step that answered with this rule's version
   * (storedSourceOf); null on a no coupon judged without the user's list,
   * which the fallback must never answer with (THE V2 SHUTDOWN), but for an
   * unpaid answer (no coupon, no code and no price, rowShowsUnpaid), stamped
   * since 2026-10-26 and answered by the fallback: with the list unread an
   * unpaid answer is no real course payment, which the list cannot change
   * (the payments are read whole). Left out of a write to a database without v113,
   * and since the review of that day of one whose copy of v113 refuses this
   * rule's stamp (refusesThisStamp).
   */
  source?: StoredSource | null;
  /** v113: the `checked_at` of the write that set `source` (stampedByThisRule); null with no source. Left out with it. */
  source_checked_at?: string | null;
}

/** Why a membership read gave no answer. */
export type MembershipReadFail =
  | "no_api_key"
  | "not_a_membership"
  | "not_found"
  | "rate_limited"
  | "time_budget"
  | "http_401_403"
  /** Another 4xx for this one id (400, 422, ...): Whop does not take it. */
  | "http_4xx"
  /** A 5xx, or any other answer that is not OK. */
  | "http_other"
  | "network"
  | "bad_shape"
  | "no_plan_price";

/**
 * Why one student's check ended with no yes or no (NO ANSWER, above). The
 * caller writes nothing for that student then. The kinds of the payment read
 * and, since T-122's fourth fix round, of the user's list of memberships:
 * filter_ignored (a row of another user), bad_page (a page in another
 * shape), too_many_pages (more than one user has). bad_shape: a membership
 * read answered with a body this code cannot read (the fourth fix round),
 * or with an object of another id or naming no code field (the fifth).
 */
export type NoAnswer =
  | "no_api_key"
  | "no_course_product"
  | "no_whop_user"
  | "network"
  | "http_other"
  | "rate_limited"
  | "time_budget"
  | "http_401_403"
  | "filter_ignored"
  | "bad_page"
  | "too_many_pages"
  | "bad_shape";

/** The read failures that are Whop not answering, or the deployment not able to ask (isNoAnswer). */
type ReadNoAnswer = "no_api_key" | "network" | "http_other" | "rate_limited" | "time_budget" | "http_401_403";
const READ_NO_ANSWER: ReadonlySet<string> = new Set<ReadNoAnswer>(["no_api_key", "network", "http_other", "rate_limited", "time_budget", "http_401_403"]);

/**
 * Whether a read's failure is Whop not answering (NO ANSWER), where the check
 * stops; any other moves to the next step. A 200 whose body cannot be read
 * (bad_shape) is not among them: the coupon check stops on it too since
 * T-122's fourth fix round, for a membership read (lookAtMembership) and the
 * user's list (findCourseMemberships), each saying so itself.
 */
export function isNoAnswer(fail: MembershipReadFail): fail is ReadNoAnswer {
  return READ_NO_ANSWER.has(fail);
}

export interface MembershipDiscount {
  whopMembershipId: string;
  promoCodeId: string | null;
  promoCode: string | null;
  renewalPrice: number;
  /** The plan's renewal price; null on a membership the coupon check settled on that names no code, whose plan it does not read (since T-122's fourth fix round). */
  planRenewalPrice: number | null;
  /** THE RULE on this membership (readMembershipDiscount); false on one the coupon check settled on, which names no coupon. */
  discounted: boolean;
}

/**
 * A membership Whop answered for whose renewal price or plan does not read
 * (bad_shape for a membership naming no plan or no renewal price,
 * no_plan_price for a plan Whop does not know or gives no price for): what
 * it names, so a caller still sees a code on it. The coupon check reads
 * memberships itself (lookAtMembership), a code there being a coupon however
 * its prices read.
 */
export interface UnpricedMembership {
  whopMembershipId: string;
  promoCodeId: string | null;
  /** Its renewal price when that read and the plan's did not; null otherwise. */
  renewalPrice: number | null;
}

export type MembershipRead =
  | { ok: true; membership: MembershipDiscount }
  | { ok: false; fail: MembershipReadFail; unpriced?: UnpricedMembership };

/** The requests one run has made and when the next may start, shared by every read of the run. */
export interface WhopPace {
  nextAt: number;
  requests: number;
  retried429: number;
}

type PlanAnswer = { ok: true; price: number } | { ok: false; fail: MembershipReadFail };

/**
 * A plan as one read gives it (readPlan): its renewal price (null when it
 * does not read) and whether it is a one-time plan (`plan_type` "one_time",
 * which never renews). Since the review of 2026-10-26 a membership with no
 * renewal price is free when its plan says so.
 */
type PlanRead = { ok: true; renewalPrice: number | null; oneTime: boolean } | { ok: false; fail: MembershipReadFail };

/**
 * What one run of reads shares: the key, the pace, the plans and the codes'
 * names already read, and the time limits. `startBy`: no request starts
 * after it. `answerBy`: an answer still missing then is given up. null for no
 * limit.
 */
export interface WhopReadContext {
  apiKey: string;
  pace: WhopPace;
  plans: Map<string, PlanRead>;
  promoNames: Map<string, string | null>;
  startBy: number | null;
  answerBy: number | null;
}

export function newReadContext(apiKey: string, startBy: number | null = null, answerBy: number | null = null): WhopReadContext {
  return {
    apiKey,
    pace: { nextAt: 0, requests: 0, retried429: 0 },
    plans: new Map(),
    promoNames: new Map(),
    startBy,
    answerBy,
  };
}

/** A price in either shape ("87.30", 87.3, { amount: "87.30" }), or null when it does not read. */
export function priceOf(value: unknown): number | null {
  const raw = value !== null && typeof value === "object" ? (value as { amount?: unknown }).amount : value;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** An id in either shape ("promo_..." or { id: "promo_..." }), or null. */
export function idOf(value: unknown): string | null {
  if (typeof value === "string") return value.trim() !== "" ? value : null;
  if (value !== null && typeof value === "object") {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" && id.trim() !== "" ? id : null;
  }
  return null;
}

const cents = (dollars: number) => Math.round(dollars * 100);

/** THE RULE (the header): a code on the membership, and a next renewal below the plan's renewal price. */
export function isDiscounted(promoCodeId: string | null, renewalPrice: number, planRenewalPrice: number): boolean {
  return promoCodeId !== null && cents(renewalPrice) < cents(planRenewalPrice);
}

/** Step 3, the price (the owner, 2026-10-21): a real payment under the course's 97.00 was most likely on a coupon. */
export function paidUnderFullPrice(total: number): boolean {
  return cents(total) < cents(FULL_PRICE);
}

/** The judgement on one payment (paymentCoupon), with the two prices the row stores. */
export interface PaymentCoupon {
  /**
   * What the payment came to after discounts: its total less a tax added on
   * top (`tax_behavior` "exclusive"); the total itself with any other
   * behaviour, or none. In the payment's own currency; null when its total
   * does not read.
   */
  price: number | null;
  /**
   * What `price` is set against: the payment's subtotal when it names a
   * code (null when that does not read); 97.00 when the price judged it
   * (step 3); else null (another currency, a plan change, not a real
   * payment, a total that does not read).
   */
  heldAgainst: number | null;
  discounted: boolean;
}

/** A payment in dollars: its currency "usd", or none named (the pinned shape always names one; the course sells in dollars). */
function inDollars(currency: string | null | undefined): boolean {
  return currency === null || currency === undefined || currency === "usd";
}

/**
 * Steps 2 and 3 on one course payment (T-122; since its third fix round,
 * 2026-10-22, the owner's rule as he put it). A payment naming a promo code
 * is a coupon whatever its totals, unless `ownCode` says the code is this
 * student's own 30% (the caller tells, isOwnThirtyCode, since that may need
 * the code's name read). A payment naming no code is held against 97.00,
 * the owner's "If they paid less than 97, most likely they have a coupon",
 * only when it is a real payment (`real` left out reads as one), in dollars
 * and no charge for a change to the subscription (`billing_reason`
 * "subscription_update"); its price is the total less a tax added on top.
 * Whop's `total` is "the price after discounts, plus any tax added on top"
 * (first-payment.ts, WhopPayment). Compared in cents. The coupon check holds
 * the student's first real course payment alone against 97.00 so
 * (firstRealPayment, since T-122's fourth fix round; every real one until
 * then). Until the third fix round a code that took nothing off was none (a
 * used one-month code on a full-price renewal), the price judged a payment
 * naming a code and a plan change's charge, and a payment in another
 * currency was held against 97.00 at its usd_total's rate.
 */
export function paymentCoupon(
  p: Pick<CoursePayment, "total" | "subtotal" | "taxOnTop" | "promoCodeId"> & Partial<Pick<CoursePayment, "real" | "currency" | "billingReason">>,
  opts: { ownCode?: boolean } = {},
): PaymentCoupon {
  const price = paidPrice(p);
  if (p.promoCodeId !== null) return { price, heldAgainst: p.subtotal, discounted: opts.ownCode !== true };
  const judged = p.real !== false && price !== null && inDollars(p.currency) && p.billingReason !== PLAN_CHANGE_REASON;
  return { price, heldAgainst: judged ? FULL_PRICE : null, discounted: judged && price !== null && paidUnderFullPrice(price) };
}

/** What a payment came to after discounts (PaymentCoupon's `price`): its total less a tax added on top; null when its total does not read. */
function paidPrice(p: Pick<CoursePayment, "total" | "taxOnTop">): number | null {
  return p.total === null ? null : (cents(p.total) - cents(p.taxOnTop ?? 0)) / 100;
}

/** A discount a payment shows with no code named (discountWithoutCode): its price and the subtotal it is below. */
export interface DiscountShown {
  price: number;
  subtotal: number;
}

/**
 * Step 2's second half (T-122's fifth fix round): a course payment naming no
 * promo code whose price (its total less a tax added on top, as step 3
 * computes it) is below its subtotal, Whop's "price before discounts, tax
 * and fees", came in on a discount all the same: a 100% first month's 0.00
 * of 97.00, a first-year 873.00 of 970.00, welcome50's EUR 44.95 of 89.90.
 * Whatever its currency (both figures are in it), real or not, refunded or
 * not. A charge for a change to the subscription (`billing_reason`
 * "subscription_update") is not judged: a plan change's proration takes
 * money off by itself. null when it shows no discount, when it names a code
 * (the first half judges it, and this student's own 30% stays no coupon), or
 * when its total or subtotal does not read. Compared in cents. Until the
 * fifth fix round such a payment was judged by the price alone, so only a
 * real first payment in dollars under 97.00 refused.
 */
export function discountWithoutCode(
  p: Pick<CoursePayment, "total" | "subtotal" | "taxOnTop" | "promoCodeId"> & Partial<Pick<CoursePayment, "billingReason">>,
): DiscountShown | null {
  if (p.promoCodeId !== null || p.billingReason === PLAN_CHANGE_REASON) return null;
  const price = paidPrice(p);
  if (price === null || p.subtotal === null) return null;
  return cents(price) < cents(p.subtotal) ? { price, subtotal: p.subtotal } : null;
}

/**
 * The code Approve makes for a student (POST /api/discounts/approve): ECOM30-
 * and the first 6 characters of the student's id, upper-cased. The approve
 * route names its code with this, so the coupon check knows it as the
 * student's own (isOwnThirtyCode).
 */
export function teamThirtyCodeFor(studentId: string): string {
  return `ECOM30-${studentId.slice(0, 6).toUpperCase()}`;
}

/**
 * Is a code this student's own 30% (THIS STUDENT'S OWN 30% CODE, the
 * header)? Its Whop promo id is on one of their own approved or applied
 * requests (`ownThirtyPromoIds`); or, only while they hold such a request
 * (`holdsOwnThirty`, or a promo id on one), its name is the one Approve makes
 * for them (teamThirtyCodeFor), the case not minded. Applied in Whop after an
 * approved request, it is the 30% itself, never a coupon. Any other code is
 * not, an ECOM30 one too. Until T-122's third fix round any ECOM30 code was
 * the team's here, so a public code named ECOM30, one named Ecom30Friends
 * and another student's code used at checkout were none; until its fourth
 * the name counted with no request, so another student's code whose id
 * starts with the same 6 characters (ECOM30-5A1B2C for both) was none.
 */
export function isOwnThirtyCode(
  student: Pick<StudentForCheck, "id" | "ownThirtyPromoIds" | "holdsOwnThirty">,
  promoCodeId: string | null,
  name: string | null | undefined,
): boolean {
  const ids = student.ownThirtyPromoIds ?? [];
  if (promoCodeId !== null && ids.includes(promoCodeId)) return true;
  const holdsOne = student.holdsOwnThirty === true || ids.length > 0;
  return holdsOne && typeof name === "string" && name.trim().toUpperCase() === teamThirtyCodeFor(student.id);
}

/** A Whop membership id the v1 read takes. The webhook has been seen to store a payment's id here. */
export function isMembershipId(id: string | null | undefined): id is string {
  return typeof id === "string" && /^mem_\w+$/.test(id);
}

/**
 * A stored row counts only for the membership it was read from (the header):
 * a student who moved to another membership since has no stored answer. When
 * the Whop id on file is not a membership's (a payment's id the old webhook
 * wrote, or none), there is no membership on file to compare: the row was
 * written for this student through their Whop user or from their payments
 * (T-122), and it counts.
 */
export function storedRowApplies(
  row: Pick<MembershipDiscountRow, "whop_membership_id"> | null | undefined,
  currentMembershipId: string | null | undefined,
): boolean {
  if (!row) return false;
  if (!isMembershipId(currentMembershipId)) return true;
  return row.whop_membership_id === currentMembershipId;
}

/** The course's Whop products: those WHOP_PRODUCT_ID names, less ETfB and Apex (whop-products.ts). Empty when it names none. */
export function courseProductIds(setting: string | undefined = process.env.WHOP_PRODUCT_ID): Set<string> {
  return new Set(
    (setting ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((id) => id !== "" && id !== ETFB_PRODUCT_ID && id !== TEAM_SEAT_PRODUCT_ID),
  );
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const TIMED_OUT = Symbol("no Whop answer by the limit");

/** fetch, or TIMED_OUT when Whop has not answered by `answerBy`. The timer is cleared either way. */
async function fetchBefore(url: string, init: RequestInit, answerBy: number): Promise<Response | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), Math.max(0, answerBy - Date.now()));
  });
  try {
    return await Promise.race([fetch(url, init), limit]);
  } finally {
    clearTimeout(timer);
  }
}

type GetAnswer = { ok: true; body: Record<string, unknown> } | { ok: false; fail: MembershipReadFail };

/**
 * One GET of one Whop answer: paced, a 429 waited out and retried twice,
 * inside the context's limits. `pinned` sends Api-Version-Date (the v1
 * reads); v2 takes none.
 */
async function whopGetUrl(url: string, ctx: WhopReadContext, pinned: boolean): Promise<GetAnswer> {
  const headers: Record<string, string> = { Authorization: `Bearer ${ctx.apiKey}`, Accept: "application/json" };
  if (pinned) headers["Api-Version-Date"] = WHOP_DISCOUNT_VERSION;
  const init: RequestInit = { headers };
  for (let attempt = 0; ; attempt++) {
    const at = Math.max(Date.now(), ctx.pace.nextAt);
    if (ctx.startBy !== null && at > ctx.startBy) return { ok: false, fail: "time_budget" };
    ctx.pace.nextAt = at + WHOP_GAP_MS;
    if (at > Date.now()) await sleep(at - Date.now());
    ctx.pace.requests += 1;
    let res: Response | typeof TIMED_OUT;
    try {
      res = ctx.answerBy === null ? await fetch(url, init) : await fetchBefore(url, init, ctx.answerBy);
    } catch {
      return { ok: false, fail: "network" };
    }
    if (res === TIMED_OUT) return { ok: false, fail: "time_budget" };
    if (res.status === 429) {
      const body = await res.text().catch(() => "");
      if (attempt >= RETRIES_AFTER_429) return { ok: false, fail: "rate_limited" };
      const waitMs = waitAfter429Ms(body, res.headers.get("retry-after"));
      if (ctx.startBy !== null && Date.now() + waitMs > ctx.startBy) return { ok: false, fail: "time_budget" };
      ctx.pace.retried429 += 1;
      // The limit is the key's, so every read of the run waits it out.
      ctx.pace.nextAt = Math.max(ctx.pace.nextAt, Date.now() + waitMs);
      continue;
    }
    if (res.status === 404) return { ok: false, fail: "not_found" };
    if (res.status === 401 || res.status === 403) return { ok: false, fail: "http_401_403" };
    if (res.status >= 400 && res.status < 500) return { ok: false, fail: "http_4xx" };
    if (!res.ok) return { ok: false, fail: "http_other" };
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, fail: "bad_shape" };
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, fail: "bad_shape" };
    return { ok: true, body: body as Record<string, unknown> };
  }
}

/** One pinned GET of one v1 object. */
function whopGet(path: string, ctx: WhopReadContext): Promise<GetAnswer> {
  return whopGetUrl(`${WHOP_API_V1}${path}`, ctx, true);
}

/**
 * The plan, read once per plan per run: its renewal price and whether it is
 * one-time. Only an answer is kept, and Whop not knowing the plan: a read Whop
 * did not answer is tried again for the next member.
 */
async function readPlan(planId: string, ctx: WhopReadContext): Promise<PlanRead> {
  const had = ctx.plans.get(planId);
  if (had) return had;
  const r = await whopGet(`/plans/${encodeURIComponent(planId)}`, ctx);
  // Whop does not know the plan, or does not take its id: nothing to read (no_plan_price).
  const answer: PlanRead = r.ok
    ? { ok: true, renewalPrice: priceOf(r.body.renewal_price), oneTime: r.body.plan_type === "one_time" }
    : { ok: false, fail: r.fail === "not_found" || r.fail === "http_4xx" ? "no_plan_price" : r.fail };
  if (answer.ok || answer.fail === "no_plan_price") ctx.plans.set(planId, answer);
  return answer;
}

/** The plan's renewal price (readPlan): no_plan_price when Whop does not know the plan or gives no price for it. */
async function planRenewalPrice(planId: string, ctx: WhopReadContext): Promise<PlanAnswer> {
  const plan = await readPlan(planId, ctx);
  if (!plan.ok) return plan;
  return plan.renewalPrice === null ? { ok: false, fail: "no_plan_price" } : { ok: true, price: plan.renewalPrice };
}

/** The code's name, read once per code per run; null when it cannot be read (then the code is this student's own only by its promo id). */
async function promoCodeName(promoCodeId: string, ctx: WhopReadContext): Promise<string | null> {
  if (ctx.promoNames.has(promoCodeId)) return ctx.promoNames.get(promoCodeId) ?? null;
  const r = await whopGet(`/promo_codes/${encodeURIComponent(promoCodeId)}`, ctx);
  if (!r.ok) {
    if (r.fail === "not_found") ctx.promoNames.set(promoCodeId, null);
    return null;
  }
  const name = typeof r.body.code === "string" && r.body.code.trim() !== "" ? r.body.code.trim() : null;
  ctx.promoNames.set(promoCodeId, name);
  return name;
}

/**
 * How far a membership grants access, as the coupon check reads Whop's
 * `status` and `valid`: 2 active (trialing, and a one-time claim that reads
 * completed, among them), 1 past_due, 0 no longer (canceled, expired). It is
 * mapStatus's reading, the sync's and the login's, but a past_due membership
 * is past_due whatever `valid` says (the review of 2026-10-26: v2's list
 * gives `valid` and v1's membership read does not, so one past_due membership
 * read the two ways gave two answers). A status that does not read is active,
 * as mapStatus has it. Used for the memberships found through the Whop user
 * (findCourseMemberships) and, since that review, for the one on file
 * (lookAtMembership).
 */
export function accessOf(status: unknown, valid: unknown): 0 | 1 | 2 {
  const raw = typeof status === "string" ? status : null;
  if (raw !== null && raw.toLowerCase() === "past_due") return 1;
  const mapped = mapStatus({ status: raw, valid: typeof valid === "boolean" ? valid : null });
  return mapped === "active" ? 2 : mapped === "past_due" ? 1 : 0;
}

type MembershipFields =
  | {
      ok: true;
      promoCodeId: string | null;
      planId: string | null;
      renewalPrice: number | null;
      productId: string | null;
      /** It grants access now (accessOf above 0): active, trialing or past_due; never canceled or expired. */
      grantsAccess: boolean;
      /** Whop's `status` as it gave it (null when it gave none): the 30% is attached only to an active or trialing one (readMembershipForApply). */
      status: string | null;
      /** Set to cancel at the end of its period: such a membership still takes the 30% (R3 of T-137). */
      cancelAtPeriodEnd: boolean;
    }
  | { ok: false; fail: MembershipReadFail };

/**
 * One GET of a membership: the code, the plan, the renewal price, the
 * product it names and, since the review of 2026-10-26, whether its status
 * grants access, each in either shape. Whop answers the membership asked
 * for, naming its code on every membership (null when none applies): an
 * object whose `id` is not the one asked for (a wrapped body, `{}`), or that
 * names neither `promo_code_id` nor the key's older `promo_code`, is a shape
 * this code does not read (bad_shape, since T-122's fifth fix round; each
 * read as a membership naming no code until then).
 */
async function membershipFields(membershipId: string, ctx: WhopReadContext): Promise<MembershipFields> {
  if (!ctx.apiKey) return { ok: false, fail: "no_api_key" };
  if (!isMembershipId(membershipId)) return { ok: false, fail: "not_a_membership" };
  const m = await whopGet(`/memberships/${encodeURIComponent(membershipId)}`, ctx);
  if (!m.ok) return m;
  if (idOf(m.body.id) !== membershipId || !("promo_code_id" in m.body || "promo_code" in m.body)) return { ok: false, fail: "bad_shape" };
  // The pinned shape names the code promo_code_id and the product product_id; the key's own older shape, promo_code: { id }.
  return {
    ok: true,
    promoCodeId: idOf(m.body.promo_code_id) ?? idOf(m.body.promo_code),
    planId: idOf(m.body.plan_id) ?? idOf(m.body.plan),
    renewalPrice: priceOf(m.body.renewal_price),
    productId: idOf(m.body.product_id) ?? idOf(m.body.product),
    grantsAccess: accessOf(m.body.status, m.body.valid) > 0,
    status: typeof m.body.status === "string" && m.body.status.trim() !== "" ? m.body.status : null,
    cancelAtPeriodEnd: m.body.cancel_at_period_end === true,
  };
}

/** One membership, as THE RULE reads it (the header). */
export async function readMembershipDiscount(membershipId: string, ctx: WhopReadContext): Promise<MembershipRead> {
  const m = await membershipFields(membershipId, ctx);
  if (!m.ok) return m;
  const { promoCodeId, planId, renewalPrice } = m;
  const unpriced: UnpricedMembership = { whopMembershipId: membershipId, promoCodeId, renewalPrice };
  if (!planId || renewalPrice === null) return { ok: false, fail: "bad_shape", unpriced };
  const plan = await planRenewalPrice(planId, ctx);
  if (!plan.ok) return plan.fail === "no_plan_price" ? { ok: false, fail: plan.fail, unpriced } : plan;
  const promoCode = promoCodeId ? await promoCodeName(promoCodeId, ctx) : null;
  return {
    ok: true,
    membership: {
      whopMembershipId: membershipId,
      promoCodeId,
      promoCode,
      renewalPrice,
      planRenewalPrice: plan.price,
      discounted: isDiscounted(promoCodeId, renewalPrice, plan.price),
    },
  };
}

// ── The 30% that applies itself (T-137): the attach, and the reads around it ──
// The shared step (src/lib/thirty-apply.ts) attaches a student's 30% code to
// their course membership and asks Whop where a code sits before it marks a
// request applied or lets the team reject it. Every call is pinned to
// WHOP_DISCOUNT_VERSION; the three reads go through whopGetUrl (paced, a 429
// waited out, inside the context's limits). No answer here names a student.

/** A membership as the 30%'s attach reads it (readMembershipForApply). */
export type MembershipForApply =
  | {
      ok: true;
      status: string | null;
      promoCodeId: string | null;
      productId: string | null;
      cancelAtPeriodEnd: boolean;
      renewalPrice: number | null;
    }
  | { ok: false; fail: MembershipReadFail };

/** One membership before the 30% goes on it: its status, the code on it, its product, whether it is set to cancel, its renewal price. */
export async function readMembershipForApply(membershipId: string, ctx: WhopReadContext): Promise<MembershipForApply> {
  const m = await membershipFields(membershipId, ctx);
  if (!m.ok) return m;
  return {
    ok: true,
    status: m.status,
    promoCodeId: m.promoCodeId,
    productId: m.productId,
    cancelAtPeriodEnd: m.cancelAtPeriodEnd,
    renewalPrice: m.renewalPrice,
  };
}

/**
 * Whop's answer to an attach: the membership now names `promoCodeId` (null
 * when it names none); or it did not take the code (`refused`: a 400, 401,
 * 403, 404 or 422, so nothing changed), or there is no telling (`unknown`: a
 * 409, a 429, a 5xx, any other status, a timeout, no connection, a 2xx body
 * that does not read). `message` is Whop's error.message, cut to 300
 * characters, or what failed.
 */
export type ApplyAnswer =
  | { ok: true; promoCodeId: string | null }
  | { ok: false; http: number | null; message: string | null; outcome: "refused" | "unknown" };

const APPLY_REFUSED = new Set([400, 401, 403, 404, 422]);
const cut300 = (s: string) => (s.length > 300 ? s.slice(0, 300) : s);

/**
 * Attaches a promo code to a membership (POST
 * /api/v1/memberships/{id}/apply_promo_code, scope member:manage, the live
 * probe of 2026-10-26): by the code's name, never its id, with a fresh
 * `idempotencyKey` every call (Whop replays a key's answer, errors included,
 * for 24 hours), within `timeoutMs`. Whop takes a code only on an active or
 * trialing membership that has none.
 */
export async function applyWhopPromoCode(
  membershipId: string,
  code: string,
  idempotencyKey: string,
  timeoutMs: number,
): Promise<ApplyAnswer> {
  const apiKey = process.env.WHOP_API_KEY;
  if (!apiKey) return { ok: false, http: null, message: "no_api_key", outcome: "refused" };
  let res: Response;
  try {
    res = await fetch(`${WHOP_API_V1}/memberships/${encodeURIComponent(membershipId)}/apply_promo_code`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Api-Version-Date": WHOP_DISCOUNT_VERSION,
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({ promo_code: code }),
      signal: AbortSignal.timeout(Math.max(0, timeoutMs)),
    });
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, http: null, message: timedOut ? "timeout" : cut300(e instanceof Error ? e.message : String(e)), outcome: "unknown" };
  }
  let body: unknown = undefined;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const object = body !== null && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (res.ok) {
    if (object === null) return { ok: false, http: res.status, message: "a body that does not read", outcome: "unknown" };
    return { ok: true, promoCodeId: idOf(object.promo_code_id) };
  }
  const error = object?.error;
  const said = error !== null && typeof error === "object" ? (error as { message?: unknown }).message : undefined;
  const message = typeof said === "string" && said.trim() !== "" ? cut300(said) : null;
  return { ok: false, http: res.status, message, outcome: APPLY_REFUSED.has(res.status) ? "refused" : "unknown" };
}

/** Why a list read gave no answer: a membership read's kinds, no company on the deployment, more pages than allowed. */
export type ListReadFail = MembershipReadFail | "no_company_id" | "too_many_pages";

/** findThirtyCodeByName reads at most this many pages of 100 codes. */
const CODE_PAGES_MAX = 5;

/**
 * A code the app made, found by its name (the 30%'s lost claim, T-137): the
 * pinned list of the company's promo codes made after `createdAfterIso`,
 * oldest first (GET /api/v1/promo_codes?account_id&created_after&direction=asc
 * &first=100, `after` paging, the probe of 2026-10-26), at most 5 pages. The
 * first whose code is `name` (trimmed, the case not minded) answers with its
 * id; none, null. A page that fails or does not read, or a list still going
 * after the 5th page, is no answer: a code not seen may still be there.
 */
export async function findThirtyCodeByName(
  name: string,
  createdAfterIso: string,
  ctx: WhopReadContext,
): Promise<{ ok: true; id: string | null } | { ok: false; fail: ListReadFail }> {
  if (!ctx.apiKey) return { ok: false, fail: "no_api_key" };
  const company = process.env.WHOP_COMPANY_ID;
  if (!company) return { ok: false, fail: "no_company_id" };
  const wanted = name.trim().toLowerCase();
  let after: string | null = null;
  for (let page = 1; page <= CODE_PAGES_MAX; page++) {
    const query = new URLSearchParams({ account_id: company, created_after: createdAfterIso, direction: "asc", first: "100" });
    if (after !== null) query.set("after", after);
    const r = await whopGetUrl(`${WHOP_API_V1}/promo_codes?${query}`, ctx, true);
    if (!r.ok) return { ok: false, fail: r.fail };
    const rows = r.body.data;
    if (!Array.isArray(rows)) return { ok: false, fail: "bad_shape" };
    for (const c of rows) {
      if (c === null || typeof c !== "object") continue;
      const listed = (c as { code?: unknown }).code;
      const id = idOf((c as { id?: unknown }).id);
      if (typeof listed === "string" && listed.trim().toLowerCase() === wanted && id !== null) return { ok: true, id };
    }
    const info = (r.body.page_info ?? null) as { has_next_page?: unknown; end_cursor?: unknown } | null;
    if (info?.has_next_page !== true) return { ok: true, id: null };
    // More codes and no cursor to reach them: not all were seen.
    if (typeof info.end_cursor !== "string" || info.end_cursor === "") return { ok: false, fail: "bad_shape" };
    after = info.end_cursor;
  }
  return { ok: false, fail: "too_many_pages" };
}

/** A membership holding a code, as Whop's list gives it (findMembershipsWithCode). userId is null for a business buyer. */
export interface MembershipWithCode {
  id: string;
  userId: string | null;
  status: string | null;
  productId: string | null;
  productTitle: string | null;
  promoCodeId: string | null;
  renewalPrice: number | null;
}

/**
 * The memberships holding a promo code (the 30%'s where read, T-137): GET
 * /api/v1/memberships?promo_code_ids=<id>&company_id=<WHOP_COMPANY_ID>
 * &first=10, pinned (the probe of 2026-10-26 answered exactly the membership
 * a code had been applied to, naming the code, with the user's id). A body
 * that does not read, or a row naming no id, is no answer.
 */
export async function findMembershipsWithCode(
  promoId: string,
  ctx: WhopReadContext,
): Promise<{ ok: true; memberships: MembershipWithCode[] } | { ok: false; fail: ListReadFail }> {
  if (!ctx.apiKey) return { ok: false, fail: "no_api_key" };
  const company = process.env.WHOP_COMPANY_ID;
  if (!company) return { ok: false, fail: "no_company_id" };
  const query = new URLSearchParams({ promo_code_ids: promoId, company_id: company, first: "10" });
  const r = await whopGetUrl(`${WHOP_API_V1}/memberships?${query}`, ctx, true);
  if (!r.ok) return { ok: false, fail: r.fail };
  const rows = r.body.data;
  if (!Array.isArray(rows) || !rows.every((m) => m !== null && typeof m === "object" && !Array.isArray(m))) {
    return { ok: false, fail: "bad_shape" };
  }
  const memberships: MembershipWithCode[] = [];
  for (const m of rows as Record<string, unknown>[]) {
    const id = idOf(m.id);
    if (id === null) return { ok: false, fail: "bad_shape" };
    const product = m.product !== null && typeof m.product === "object" ? (m.product as { title?: unknown }) : null;
    memberships.push({
      id,
      userId: idOf(m.user) ?? idOf(m.user_id),
      status: typeof m.status === "string" ? m.status : null,
      productId: idOf(m.product_id) ?? idOf(m.product),
      productTitle: typeof product?.title === "string" && product.title.trim() !== "" ? product.title.trim() : null,
      promoCodeId: idOf(m.promo_code_id) ?? idOf(m.promo_code),
      renewalPrice: priceOf(m.renewal_price),
    });
  }
  return { ok: true, memberships };
}

/**
 * What the coupon check makes of one membership (step 1 of the owner's rule,
 * the header): a code on it other than this student's own 30% (`coupon`,
 * with its prices when they read); else its prices (`priced`, settled on
 * when nothing is a coupon), or that its renewal price does not read, or,
 * for a membership naming this student's own code, its plan
 * (`unpriced`); or that Whop does not know the id (`unknown`), that it is a
 * membership of another product (`other_product`, since T-122's fifth fix
 * round: its `product_id` names one, and not one of the course's), or gave
 * no answer (`no_answer`), a 200 whose body cannot be read among them
 * (bad_shape, since T-122's fourth fix round: it read as `unpriced`, no code
 * seen). The reads: the membership; for a membership naming a code its plan
 * (once per run) and the code's name (once per run). A membership naming no
 * code has its plan read no more since the fourth fix round: under the
 * owner's rule it decides nothing, and the renewal price alone says paid or
 * free. A membership naming no product is read as the course's, as the v2
 * list's rows naming none are.
 * Since the review of 2026-10-26 (the owner's paid plan and payment, THE PAID
 * PLAN AND THE PAYMENT in the header), two more:
 *   - a membership whose status no longer grants access (accessOf: canceled
 *     or expired) and that names no coupon is `ended`, whatever its renewal
 *     price: read for a code alone, never the paid plan, as the ended ones
 *     found through the Whop user already were (it was `priced` or
 *     `unpriced` by its renewal price, so a canceled course membership on
 *     file renewing above 0 stood in for a paid plan);
 *   - a membership naming no code whose renewal price does not read (Whop
 *     gives none for a membership that does not renew) has its plan read
 *     (readPlan, once per plan per run): a one-time plan, or one renewing at
 *     0, is free (`priced`, read as renewing at 0), and only a plan renewing
 *     above 0 or one that does not read leaves it `unpriced`, the payment
 *     deciding then. Until then every such membership was `unpriced`, so a
 *     free plan whose renewal price read empty let a real payer in.
 */
type MembershipLook =
  | { kind: "coupon"; promoCodeId: string; promoCode: string | null; renewalPrice: number | null; planRenewalPrice: number | null }
  | { kind: "priced"; membership: MembershipDiscount }
  | { kind: "unpriced" }
  | { kind: "ended" }
  | { kind: "unknown" }
  | { kind: "other_product" }
  | { kind: "no_answer"; fail: MembershipReadFail & NoAnswer };

/** A membership the check reads as free: no code, renewing at 0. */
const freeMembership = (membershipId: string): MembershipLook => ({
  kind: "priced",
  membership: { whopMembershipId: membershipId, promoCodeId: null, promoCode: null, renewalPrice: 0, planRenewalPrice: null, discounted: false },
});

async function lookAtMembership(
  membershipId: string,
  ctx: WhopReadContext,
  ownCode: (promoCodeId: string, name: string | null) => boolean,
  course: ReadonlySet<string>,
): Promise<MembershipLook> {
  const m = await membershipFields(membershipId, ctx);
  if (!m.ok) {
    if (isNoAnswer(m.fail)) return { kind: "no_answer", fail: m.fail };
    // A 200 whose body cannot be read: no code can be seen on it, which is no answer, never "no code".
    if (m.fail === "bad_shape") return { kind: "no_answer", fail: "bad_shape" };
    // A 404 or another 4xx for this one id: Whop does not know it.
    return { kind: "unknown" };
  }
  // Another product's membership: its code is that product's, never a course coupon (T-122's fifth fix round).
  if (m.productId !== null && !course.has(m.productId)) return { kind: "other_product" };
  const { promoCodeId, planId, renewalPrice, grantsAccess } = m;
  if (promoCodeId === null) {
    // No longer granting access (canceled, expired): never the paid plan, whatever it renews at (2026-10-26).
    if (!grantsAccess) return { kind: "ended" };
    if (renewalPrice !== null) {
      return {
        kind: "priced",
        membership: { whopMembershipId: membershipId, promoCodeId: null, promoCode: null, renewalPrice, planRenewalPrice: null, discounted: false },
      };
    }
    // No renewal price: the plan says whether it is free (2026-10-26). Whop not answering for it is no answer, as for
    // any read; a plan Whop does not know, or one renewing above 0, leaves the membership unpriced.
    if (planId === null) return { kind: "unpriced" };
    const plan = await readPlan(planId, ctx);
    if (!plan.ok) return isNoAnswer(plan.fail) ? { kind: "no_answer", fail: plan.fail } : { kind: "unpriced" };
    const free = plan.oneTime || (plan.renewalPrice !== null && cents(plan.renewalPrice) <= 0);
    return free ? freeMembership(membershipId) : { kind: "unpriced" };
  }
  const plan = planId !== null && renewalPrice !== null ? await planRenewalPrice(planId, ctx) : null;
  const promoCode = await promoCodeName(promoCodeId, ctx);
  // A code other than this student's own 30% is a coupon, whatever the renewal price, and whether it or the plan reads.
  if (!ownCode(promoCodeId, promoCode)) {
    return { kind: "coupon", promoCodeId, promoCode, renewalPrice, planRenewalPrice: plan?.ok ? plan.price : null };
  }
  // This student's own 30% on a membership that no longer grants access: never the paid plan either.
  if (!grantsAccess) return { kind: "ended" };
  if (plan === null || renewalPrice === null) return { kind: "unpriced" };
  if (!plan.ok) return isNoAnswer(plan.fail) ? { kind: "no_answer", fail: plan.fail } : { kind: "unpriced" };
  return {
    kind: "priced",
    membership: { whopMembershipId: membershipId, promoCodeId, promoCode, renewalPrice, planRenewalPrice: plan.price, discounted: false },
  };
}

export type CourseMembershipFind =
  | {
      ok: true;
      /** The course memberships that grant access, in the order the check reads them. */
      membershipIds: string[];
      /** The course memberships that no longer grant access (canceled, expired), the newest first: read for a code alone. */
      endedIds: string[];
      /** The list answered a 404 or another 4xx (a 410 once v2 is gone): read as no memberships, and counted by the cron. */
      unusable: boolean;
    }
  | { ok: false; fail: NoAnswer };

/**
 * Every course membership of the user, in the order the check reads them.
 * `membershipIds` holds those that grant access, active before past_due
 * (accessOf: mapStatus, as the sync and the login read Whop's status, with a
 * past_due one past_due whatever `valid` says since the review of
 * 2026-10-26, as the membership on file reads), then the
 * newest created_at, a date missing read as the oldest, a tie in Whop's
 * order; `endedIds` those that no longer do (canceled or expired), the
 * newest first, which the check reads for a code alone (since T-122's fourth
 * fix round: a code on one was never read, so a 100% first month on a
 * canceled membership, the student back at 97.00 on a new one, passed). A
 * row naming no product counts, as in the login's lookup. Until the fourth
 * fix round the plans of two or more memberships were read to put the paid
 * ones first; the check now tells paid from free by each membership's own
 * renewal price (judgeStudentDiscount).
 * A list this code cannot judge is NO ANSWER, as for the payments
 * (fetchCoursePayments, A PAGE IN ANOTHER SHAPE in first-payment.ts): a page
 * in another shape (`bad_page`: its body not JSON or no object, its `data` no
 * list of objects, or rows of which not one names its buyer or not one a
 * membership id), a row of another user (`filter_ignored`: Whop ignored the
 * user filter), more pages than USER_PAGES_MAX (`too_many_pages`, said by
 * the first page that names more, so no more are read); until the fourth fix
 * round each read as no memberships. So is a read of the list Whop does not
 * answer. A 404 or another 4xx for the list is `unusable`: no memberships,
 * the check going on without them, and the cron counting the student
 * (user_list_unusable).
 */
export async function findCourseMemberships(
  whopUserId: string,
  course: ReadonlySet<string>,
  ctx: WhopReadContext,
): Promise<CourseMembershipFind> {
  type Found = { id: string; access: number; created: number; listed: number };
  const found: Found[] = [];
  const ended: Found[] = [];
  let lastPage = false;
  for (let page = 1; page <= USER_PAGES_MAX && !lastPage; page++) {
    const r = await whopGetUrl(
      `${WHOP_API_V2}/memberships?user_id=${encodeURIComponent(whopUserId)}&per=50&page=${page}`,
      ctx,
      false,
    );
    if (!r.ok) {
      if (isNoAnswer(r.fail)) return { ok: false, fail: r.fail };
      if (r.fail === "bad_shape") return { ok: false, fail: "bad_page" };
      return { ok: true, membershipIds: [], endedIds: [], unusable: true };
    }
    const rows = r.body.data;
    if (!Array.isArray(rows) || !rows.every((m) => m !== null && typeof m === "object" && !Array.isArray(m))) {
      return { ok: false, fail: "bad_page" };
    }
    const list = rows as Record<string, unknown>[];
    // Rows of which not one names its buyer, or not one a membership id: a shape this code does not read.
    if (list.length > 0 && (!list.some((m) => idOf(m.user) !== null) || !list.some((m) => isMembershipId(typeof m.id === "string" ? m.id : null)))) {
      return { ok: false, fail: "bad_page" };
    }
    if (list.some((m) => idOf(m.user) !== null && idOf(m.user) !== whopUserId)) return { ok: false, fail: "filter_ignored" };
    for (const m of list) {
      const id = typeof m.id === "string" ? m.id : null;
      if (!isMembershipId(id)) continue;
      const product = idOf(m.product);
      if (product !== null && !course.has(product)) continue;
      // past_due is past_due whatever `valid` says, as on file (accessOf; since the review of 2026-10-26).
      const access = accessOf(m.status, m.valid);
      const iso = typeof m.created_at === "string" || typeof m.created_at === "number" ? toIso(m.created_at) : null;
      const created = iso === null ? NaN : Date.parse(iso);
      const row = { id, access, created: Number.isFinite(created) ? created : -Infinity, listed: found.length + ended.length };
      (access === 0 ? ended : found).push(row);
    }
    const pagination = (r.body.pagination ?? null) as { current_page?: unknown; total_page?: unknown } | null;
    const current = typeof pagination?.current_page === "number" ? pagination.current_page : page;
    const total = typeof pagination?.total_page === "number" ? pagination.total_page : current;
    // More pages than one user has: no answer now, with no more pages read.
    if (total > USER_PAGES_MAX) return { ok: false, fail: "too_many_pages" };
    lastPage = current >= total;
  }
  if (!lastPage) return { ok: false, fail: "too_many_pages" };

  // A difference of two missing dates is NaN, which reads as a tie.
  const order = (a: Found, b: Found) => b.access - a.access || b.created - a.created || a.listed - b.listed;
  return { ok: true, membershipIds: found.sort(order).map((f) => f.id), endedIds: ended.sort(order).map((f) => f.id), unusable: false };
}

/** A student as the check reads them: the Whop membership id on file and the Whop user. */
export interface StudentForCheck {
  id: string;
  whop_membership_id: string | null;
  whop_user_id: string | null;
  /**
   * students.first_paid_at: the payment it names is the first real course
   * payment the price judges, when the list holds it (firstRealPayment).
   * Left out or null, the earliest real course payment the list gives.
   */
  first_paid_at?: string | null;
  /**
   * The Whop promo ids on this student's own approved or applied 30%
   * requests (discount_requests.whop_promo_id): their own 30% code by its id
   * (isOwnThirtyCode). checkMembershipDiscount reads them; the cron leaves
   * out every student holding such a request, so it hands none.
   */
  ownThirtyPromoIds?: readonly string[];
  /**
   * The student holds an approved or applied 30% request of their own
   * (checkMembershipDiscount reads it with the promo ids): only then is a
   * code named as Approve names theirs their own (isOwnThirtyCode, since
   * T-122's fourth fix round). A promo id in `ownThirtyPromoIds` says so too.
   */
  holdsOwnThirty?: boolean;
}

export type StudentDiscountRead =
  | {
      ok: true;
      /** The step that answered (the cron's by_source, the routes' via). The row's own `source` is its stamp. */
      source: DiscountSource;
      /**
       * The row to store, `checked_at` and THE RULE STAMP set (its `source` null on a no coupon judged without the
       * user's list, but for an unpaid answer, stamped all the same since 2026-10-26).
       */
      row: MembershipDiscountRow;
      /**
       * No coupon, and no real course payment: the student is unpaid, whatever
       * the memberships say (THE PAID PLAN AND THE PAYMENT, the header; since
       * 2026-10-26 a membership renewing above 0 no longer stands in for it).
       * Source "payment".
       */
      noRealPayment: boolean;
      /**
       * No coupon, a real course payment, and no course membership on a paid
       * plan: none renewing above 0 settled on, every renewal price read and
       * the user's list answered (the owner, 2026-10-26: a free plan, or no
       * course membership at all). The student is unpaid; never true with
       * `noRealPayment`. False when the plan cannot be known (a renewal price
       * that did not read, the list answering a 404 or another 4xx): the
       * payment decides then. Source "payment".
       */
      noPaidPlan: boolean;
      /**
       * The Whop user's list of memberships answered a 404 or another 4xx (a
       * 410 once v2 is gone), so the check went on without it, by the
       * membership on file and the payments (T-122's fourth fix round). The
       * cron counts these (user_list_unusable).
       */
      userListUnusable: boolean;
      /**
       * The price alone refused (step 3: no code anywhere, the first real
       * course payment under 97.00): that payment's price and billing_reason,
       * which the cron lists (refused_by_price) for the owner to rule on.
       * null for every other answer.
       */
      byPrice: { price: number; billingReason: string | null } | null;
      /**
       * A payment naming no code showed a discount (step 2's second half,
       * T-122's fifth fix round): its price, its subtotal, its currency and
       * billing_reason, which the cron lists (refused_by_subtotal) for the
       * owner to rule on. null for every other answer.
       */
      bySubtotal: { price: number; subtotal: number; currency: string | null; billingReason: string | null } | null;
    }
  | { ok: false; fail: NoAnswer };

/**
 * The student's first real course payment, the one the price judges (step 3,
 * since T-122's fourth fix round: "if they paid less than 97"): among the
 * real payments naming their buyer, those at the moment
 * students.first_paid_at names, else those at the earliest moment the list
 * gives (first_paid_at left out, null, or naming a payment of another
 * product or one no longer real), in whatever order the list comes. Of
 * those, since T-122's fifth fix round, the checkout (`billing_reason`
 * "subscription_create"), else the one with the highest price (its total
 * less a tax added on top); a full tie goes to the one listed last, as
 * fetchCoursePayments lists newest first and a tie in Whop's order. Until
 * then the first listed at first_paid_at's moment was taken, so a 10.00
 * add-on listed before the 97.00 checkout refused. A row naming no buyer is
 * never it (the first-paid rule leaves it out too). A real payment always
 * has its paid_at. null with no real course payment.
 */
export function firstRealPayment(payments: readonly CoursePayment[], firstPaidAt: string | null | undefined): CoursePayment | null {
  const at = (p: CoursePayment) => (p.paidAt === null ? NaN : Date.parse(p.paidAt));
  const real = payments.filter((p) => p.real && p.buyerNamed !== false && Number.isFinite(at(p)));
  if (real.length === 0) return null;
  const named = typeof firstPaidAt === "string" ? Date.parse(firstPaidAt) : NaN;
  const moment = Number.isFinite(named) && real.some((p) => at(p) === named) ? named : Math.min(...real.map(at));
  const atMoment = real.filter((p) => at(p) === moment);
  const checkouts = atMoment.filter((p) => p.billingReason === CHECKOUT_REASON);
  const pool = checkouts.length > 0 ? checkouts : atMoment;
  const price = (p: CoursePayment) => cents(paidPrice(p) ?? 0);
  let first = pool[0];
  for (const p of pool) if (price(p) >= price(first)) first = p;
  return first;
}

/** The stored row for a student's membership as read now, with THE RULE STAMP for `source`, the step. */
export function rowOf(studentId: string, m: MembershipDiscount, checkedAt: string, source: DiscountSource = "membership"): MembershipDiscountRow {
  return {
    student_id: studentId,
    whop_membership_id: m.whopMembershipId,
    promo_code_id: m.promoCodeId,
    promo_code: m.promoCode,
    renewal_price: m.renewalPrice,
    plan_renewal_price: m.planRenewalPrice,
    discounted: m.discounted,
    checked_at: checkedAt,
    source: storedSourceOf(source),
    source_checked_at: checkedAt,
  };
}

/**
 * One student, yes or no, by the owner's rule in the header's order (a code
 * on a membership, a code or a discount on a payment, then the price), or
 * the kind of NO ANSWER. Writes nothing. The row it hands back carries THE
 * RULE STAMP, or no source on a no coupon judged without the user's list
 * (THE V2 SHUTDOWN), an unpaid answer excepted since 2026-10-26: it is
 * stamped all the same (THE PAID PLAN AND THE PAYMENT).
 */
export async function judgeStudentDiscount(student: StudentForCheck, ctx: WhopReadContext): Promise<StudentDiscountRead> {
  if (!ctx.apiKey) return { ok: false, fail: "no_api_key" };
  // The course's products. Since T-122's fifth fix round the membership on file is checked against them too, so with
  // none named nothing can be judged and nothing is read (the membership on file was read first until then).
  const course = courseProductIds();
  if (course.size === 0) return { ok: false, fail: "no_course_product" };
  const now = () => new Date().toISOString();
  // The user's list answered a 4xx: the check goes on without it, and the cron counts it.
  let userListUnusable = false;
  type Answered = Extract<StudentDiscountRead, { ok: true }>;
  const found = (
    source: DiscountSource,
    row: MembershipDiscountRow,
    more: Partial<Pick<Answered, "noRealPayment" | "noPaidPlan" | "byPrice" | "bySubtotal">> = {},
  ): StudentDiscountRead => {
    const noRealPayment = more.noRealPayment ?? false;
    const noPaidPlan = more.noPaidPlan ?? false;
    // THE RULE STAMP, the step with this rule's version and the write's own moment. A no coupon judged without the
    // user's list may have missed a code on a second, canceled or expired membership (THE V2 SHUTDOWN): the student
    // gets it live, and its row is stored with no source, so the stored fallback never answers with it. An unpaid
    // answer refuses whatever a code would have said, so it is stamped (since 2026-10-26).
    const unstamped = userListUnusable && !row.discounted && !noRealPayment && !noPaidPlan;
    return {
      ok: true,
      source,
      row: { ...row, source: unstamped ? null : storedSourceOf(source), source_checked_at: unstamped ? null : row.checked_at },
      noRealPayment,
      noPaidPlan,
      userListUnusable,
      byPrice: more.byPrice ?? null,
      bySubtotal: more.bySubtotal ?? null,
    };
  };
  const own = (promoCodeId: string | null, name: string | null) => isOwnThirtyCode(student, promoCodeId, name);
  const membershipCoupon = (
    membershipId: string,
    look: Extract<MembershipLook, { kind: "coupon" }>,
    source: "membership" | "user",
  ): StudentDiscountRead =>
    found(source, {
      student_id: student.id,
      whop_membership_id: membershipId,
      promo_code_id: look.promoCodeId,
      promo_code: look.promoCode,
      renewal_price: look.renewalPrice,
      plan_renewal_price: look.planRenewalPrice,
      discounted: true,
      checked_at: now(),
    });
  // Each membership read once: the one on file is found again through the Whop user. A read that gave no answer is
  // never kept (the check stops on it).
  const looked = new Map<string, MembershipLook>();
  /** One membership's look, read once. */
  const look = async (id: string): Promise<MembershipLook> => {
    const had = looked.get(id);
    if (had) return had;
    const got = await lookAtMembership(id, ctx, own, course);
    if (got.kind !== "no_answer") looked.set(id, got);
    return got;
  };
  // The membership the check settled on: it answers when nothing is a coupon.
  let settled: { membership: MembershipDiscount; source: "membership" | "user" } | null = null;
  // A membership that grants access whose renewal price does not read, and whose plan neither says it is free nor reads
  // (or, naming this student's own code, whose plan does not read): the payments answer then.
  let unpriced: string | null = null;

  // 1. A code on the membership on file. Renewing at 0 (a free plan) it is not settled on: a paid one found through the
  // Whop user is (the sync and the webhook put the newest membership that grants access on file).
  const onFile = student.whop_membership_id;
  if (isMembershipId(onFile)) {
    const seen = await look(onFile);
    if (seen.kind === "no_answer") return { ok: false, fail: seen.fail };
    if (seen.kind === "coupon") return membershipCoupon(onFile, seen, "membership");
    if (seen.kind === "priced" && cents(seen.membership.renewalPrice) > 0) settled = { membership: seen.membership, source: "membership" };
    if (seen.kind === "unpriced") unpriced = onFile;
    // "ended" (canceled or expired, since the review of 2026-10-26: read for a code alone, never the paid plan),
    // "unknown" (a 404, or another 4xx for the id on file) or, since the fifth fix round, "other_product" (a membership
    // of another product, which the webhook stores as it stores the course's): passed over, the last two with their
    // code never read.
  }

  if (!student.whop_user_id) return { ok: false, fail: "no_whop_user" };

  // The user's course memberships and every course payment (the $0 ones too), read at the same time (T-122's fourth
  // fix round: one after the other, a Whop slower than 2 seconds an answer gave the request routes' 503).
  const [list, paid] = await Promise.all([
    findCourseMemberships(student.whop_user_id, course, ctx),
    fetchCoursePayments(student.whop_user_id, {
      apiKey: ctx.apiKey,
      pace: ctx.pace,
      startBy: ctx.startBy,
      answerBy: ctx.answerBy,
      productIds: course,
    }),
  ]);
  if (!list.ok) return list;
  userListUnusable = list.unusable;

  // 1. A code on any course membership found through the Whop user, whatever the one on file said: first those that
  // grant access, one after the other (a membership of another product passed over, since the fifth fix round).
  const candidates: MembershipDiscount[] = [];
  for (const id of list.membershipIds) {
    const seen = await look(id);
    if (seen.kind === "no_answer") return { ok: false, fail: seen.fail };
    if (seen.kind === "coupon") return membershipCoupon(id, seen, "user");
    if (seen.kind === "priced") candidates.push(seen.membership);
    else if (seen.kind === "unpriced") unpriced ??= id;
    // "unknown" (v1 does not know a membership v2 lists), "ended" (v1 reads it canceled or expired now) and
    // "other_product": passed over, as on file (since the review of 2026-10-26; until then "unknown" counted as a
    // membership whose price did not read, so the payment decided beside a free plan on file).
  }
  // Then those that no longer grant access, read for a code alone and never settled on (the fourth fix round), all
  // at once since the fifth (one after the other, two of them went past the request routes' limits at 2 seconds an
  // answer), and judged in their order: the first coupon or no answer decides as soon as it is in.
  const ended = list.endedIds.map((id) => look(id));
  for (let i = 0; i < ended.length; i++) {
    const seen = await ended[i];
    if (seen.kind === "no_answer") return { ok: false, fail: seen.fail };
    if (seen.kind === "coupon") return membershipCoupon(list.endedIds[i], seen, "user");
  }
  // No code on any: the first that renews above 0 is settled on, else the first that renews at 0, unless one gave no price.
  if (settled === null && unpriced === null) {
    const first = candidates.find((m) => cents(m.renewalPrice) > 0) ?? candidates[0] ?? null;
    if (first !== null) settled = { membership: first, source: "user" };
  }

  // A payments read Whop does not answer is no answer.
  if (!paid.ok) return { ok: false, fail: paid.fail };
  const judgedOn = settled?.membership.whopMembershipId ?? unpriced;
  const paymentRow = (p: CoursePayment, price: number | null, heldAgainst: number | null, promoCode: string | null): MembershipDiscountRow => ({
    student_id: student.id,
    whop_membership_id: p.membershipId ?? judgedOn ?? null,
    promo_code_id: p.promoCodeId,
    promo_code: promoCode,
    renewal_price: price,
    plan_renewal_price: heldAgainst,
    discounted: true,
    checked_at: now(),
  });

  // 2. A code on any course payment other than this student's own 30%, whatever its totals.
  for (const p of paid.payments) {
    if (p.promoCodeId === null) continue;
    const promoCode = p.promoCode ?? (await promoCodeName(p.promoCodeId, ctx));
    if (own(p.promoCodeId, promoCode)) continue;
    const judged = paymentCoupon(p);
    return found("payment", paymentRow(p, judged.price, judged.heldAgainst, promoCode));
  }
  // And, since the fifth fix round, a discount any course payment naming no code shows: its price below its subtotal.
  for (const p of paid.payments) {
    const shown = discountWithoutCode(p);
    if (shown === null) continue;
    return found("payment", paymentRow(p, shown.price, shown.subtotal, null), {
      bySubtotal: { price: shown.price, subtotal: shown.subtotal, currency: p.currency, billingReason: p.billingReason },
    });
  }

  // 3. No code or discount anywhere: the price of the student's first real course payment alone, naming no code, in
  // dollars and no plan change, under 97.00 (the fourth fix round: every real payment until then, so a later manual
  // charge or add-on under 97.00 refused a student who came in at full price).
  const first = firstRealPayment(paid.payments, student.first_paid_at);
  if (first !== null && first.promoCodeId === null) {
    const judged = paymentCoupon(first);
    if (judged.discounted && judged.price !== null) {
      return found("payment", paymentRow(first, judged.price, judged.heldAgainst, null), {
        byPrice: { price: judged.price, billingReason: first.billingReason },
      });
    }
  }

  // No coupon. THE PAID PLAN AND THE PAYMENT (the owner, 2026-10-26: "If they don't have a payment and a paid plan - no
  // applying to 30% off"): the 30% needs both a real course payment and a course membership on a paid plan. The paid
  // plan is a membership that grants access renewing above 0 settled on. When none is, the plan is not known if a
  // membership that grants access gave no renewal price and its plan neither said it is free nor read, or the user's
  // list answered a 404 or another 4xx, and the payment decides: a real payer whose membership gives no price, or whose
  // memberships v2 does not list, is never refused for the plan. Until then a membership renewing above 0 stood in for
  // a payment it did not show, and a free one beside a real payment passed.
  const paidPlan = settled !== null && cents(settled.membership.renewalPrice) > 0;
  const planUnknown = !paidPlan && (unpriced !== null || list.unusable);
  const noRealPayment = first === null;
  const noPaidPlan = !noRealPayment && !paidPlan && !planUnknown;
  if (first !== null && !noPaidPlan) {
    // A real payment and a paid plan: the membership answers, no coupon.
    if (settled !== null && paidPlan) return found(settled.source, rowOf(student.id, settled.membership, now(), settled.source));
    // A real payment, the plan not known: the first real payment answers, no coupon. A code still named on it is this
    // student's own 30% (any other was a coupon above).
    const judged = paymentCoupon(first, { ownCode: true });
    const promoCode = first.promoCode ?? (first.promoCodeId ? await promoCodeName(first.promoCodeId, ctx) : null);
    return found("payment", {
      student_id: student.id,
      whop_membership_id: unpriced ?? first.membershipId ?? null,
      promo_code_id: first.promoCodeId,
      promo_code: promoCode,
      renewal_price: judged.price,
      plan_renewal_price: judged.heldAgainst,
      discounted: false,
      checked_at: now(),
    });
  }
  // Unpaid: no coupon, no code and no price (rowShowsUnpaid). The row names the membership on file when it is one, so
  // it counts while that stays on file (storedRowApplies: the map, the 30% page's verdict and the stored fallback; the
  // review of 2026-10-26, a row naming none never applied beside a membership id on file); else the membership whose
  // read gave no price, else the free one settled on.
  return found(
    "payment",
    {
      student_id: student.id,
      whop_membership_id: isMembershipId(onFile) ? onFile : (unpriced ?? settled?.membership.whopMembershipId ?? null),
      promo_code_id: null,
      promo_code: null,
      renewal_price: null,
      plan_renewal_price: null,
      discounted: false,
      checked_at: now(),
    },
    { noRealPayment, noPaidPlan },
  );
}

/**
 * Whether a stored row is judgeStudentDiscount's unpaid answer (THE PAID PLAN
 * AND THE PAYMENT, the header: `noRealPayment` or `noPaidPlan`, the owner's
 * "If they don't have a payment and a paid plan - no applying to 30% off"):
 * no coupon, no code and no price. Every other answer this rule stores holds a
 * price: a coupon's row is discounted, and a no coupon answers only beside a
 * real course payment, with the renewal price of the paid membership settled
 * on (one is settled on only when its price reads) or the real payment's own
 * (a real payment's total always reads). So the row says it exactly, and
 * client-tests/membership-discount.test.mjs holds it to every answer of
 * judgeStudentDiscount there. Every rule before this one stored that shape only
 * with no real course payment (the rules before T-122 stored no row without a
 * price), which this rule refuses too, so the row means unpaid whoever wrote
 * it: the map reads it with no stamp (/api/student/data), the stored fallback
 * only on a row this rule wrote that answers (checkMembershipDiscount: the
 * request routes and the approve route), and the 30% page's verdict
 * (thirty-view.ts couponOf). Strict: a column that was not read (undefined)
 * never reads as no price. It was rowShowsNoRealPayment until 2026-10-26.
 */
export function rowShowsUnpaid(row: { discounted?: unknown; promo_code_id?: unknown; renewal_price?: unknown }): boolean {
  return row.discounted === false && row.promo_code_id === null && row.renewal_price === null;
}

/** A row as a database without v113 takes it: everything but `source` and `source_checked_at`. */
function withoutSource(row: MembershipDiscountRow): MembershipDiscountRow {
  const copy = { ...row };
  delete copy.source;
  delete copy.source_checked_at;
  return copy;
}

/**
 * PostgREST's "Could not find the 'source' column" (PGRST204), or Postgres's
 * undefined column (42703), naming `source` or `source_checked_at`: a
 * database without v113.
 */
export function lacksSourceColumn(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!error && (error.code === "PGRST204" || error.code === "42703") && /\bsource(?:_checked_at)?\b/.test(error.message ?? "");
}

/**
 * Postgres's check violation (23514) on v113's check of `source`
 * (student_membership_discounts_source_check): the database holds a copy of
 * v113 that takes other versions of the rule alone, so THE RULE STAMP of this
 * one is refused. The copy in production's tree (cac0c07) takes the r5 values
 * alone, and this rule writes r6 since 2026-10-26.
 */
export function refusesThisStamp(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  return !!error && error.code === "23514" && /\bstudent_membership_discounts_source_check\b/.test(error.message ?? "");
}

/**
 * Writes rows to student_membership_discounts, one per student. A database
 * without v113 refuses a row that carries `source` and `source_checked_at`,
 * and since the review of 2026-10-26 so does one whose copy of v113 refuses
 * this rule's stamp (refusesThisStamp: every write of the r6 rule failed on
 * the r5-only copy until then, so no row was stored, the map got no flag and
 * the cron answered 500 on every run): the rows go again without them, and
 * `run.withoutSource` remembers, so a run asks once (`run.stampRefused` says
 * which it was). Rows written so carry no stamp of this rule, so the stored
 * fallback never answers a no coupon with them (the request routes' 503 when
 * Whop does not answer), while the map and the 30% page read them as they
 * read any row. The error's message, or null.
 */
async function upsertDiscountRows(
  db: SupabaseClient,
  rows: MembershipDiscountRow[],
  run: { withoutSource: boolean; stampRefused?: boolean },
): Promise<string | null> {
  if (!run.withoutSource) {
    const { error } = await db.from(MEMBERSHIP_DISCOUNTS_TABLE).upsert(rows, { onConflict: "student_id" });
    if (!error) return null;
    const refused = refusesThisStamp(error);
    if (!refused && !lacksSourceColumn(error)) return error.message;
    if (refused) {
      run.stampRefused = true;
      console.warn(
        `[membership discount] v113's check refuses this rule's ${RULE_VERSION} stamp (a copy of v113 that takes other versions alone), so the rows are written without it until the copy in this tree is pasted`,
      );
    }
    run.withoutSource = true;
  }
  const { error } = await db.from(MEMBERSHIP_DISCOUNTS_TABLE).upsert(rows.map(withoutSource), { onConflict: "student_id" });
  return error ? error.message : null;
}

/** The code as a sentence names it: its name, or its Whop promo id when the name could not be read. */
export function codeOf(row: { promo_code?: string | null; promo_code_id?: string | null } | null | undefined): string | null {
  return row?.promo_code ?? row?.promo_code_id ?? null;
}

export interface CouponCheck {
  /** A coupon: no 30%. */
  discounted: boolean;
  /** The code (codeOf), when there is one. */
  code: string | null;
  /**
   * live: Whop answered now. stored: the stored row for this membership, a
   * coupon, or no coupon written by this rule and by nothing since (THE RULE
   * STAMP, v113), naming no code or this student's own 30% by their
   * request's promo id (storedNoCouponAnswers), the student's row read.
   * none: neither; the request routes then refuse (the owner's review,
   * 2026-10-21), and so does the approve route's normal Approve since
   * T-122's fourth fix round, Approve anyway going on.
   */
  source: "live" | "stored" | "none";
  /** The step that answered a live check (DiscountSource); null when `source` is not live. */
  via: DiscountSource | null;
  /** Why Whop gave no answer now (NO ANSWER), or the student's row could not be read; null when Whop answered. */
  liveFail: NoAnswer | "student_unread" | null;
  /**
   * Whop's answer now was written to student_membership_discounts. False
   * whenever `source` is not live, and for a live answer whose write failed
   * (logged): "Check Whop again" says so, since its list would still show
   * the old row (the render review's second round).
   */
  saved: boolean;
  /**
   * No coupon, and Whop does not show both a real course payment and a course
   * membership on a paid plan (THE PAID PLAN AND THE PAYMENT, the header;
   * judgeStudentDiscount's noRealPayment or noPaidPlan on a live answer, or
   * rowShowsUnpaid on a stored row this rule wrote that answers). Both request
   * routes then refuse before writing, and the approve route's normal Approve
   * refuses with code "rule". False with any other answer. It was
   * `noRealPayment`, no real payment and no membership renewing above 0, until
   * the owner's answers of 2026-10-26.
   */
  unpaid: boolean;
  /**
   * The membership the answer was read from, where the 30% that applies
   * itself attaches the code first (T-137): for a live answer the row's
   * `whop_membership_id` when it is a membership's (`mem_`), for a stored
   * answer the stored row's, with no answer (source "none") null.
   */
  membershipId: string | null;
}

/** The student's own approved or applied 30% requests, as the check reads them (THIS STUDENT'S OWN 30% CODE, the header). */
interface OwnThirty {
  /** Their Whop promo ids (discount_requests.whop_promo_id). */
  promoIds: string[];
  /** Whether they hold one at all: only then is a code named as Approve names theirs their own. */
  held: boolean;
}

/**
 * The student's own approved or applied requests (THIS STUDENT'S OWN 30%
 * CODE, the header). A read that fails gives none, and a line says so: no
 * code is then known to be their own (since T-122's fourth fix round the
 * name counts only beside such a request), so the check can only find more
 * coupons, never fewer.
 */
async function ownThirtyOf(db: SupabaseClient, studentId: string): Promise<OwnThirty> {
  try {
    const { data, error } = await db
      .from("discount_requests")
      .select("whop_promo_id")
      .eq("student_id", studentId)
      .in("status", ["approved", "applied"]);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as { whop_promo_id?: unknown }[];
    return {
      promoIds: rows.map((r) => r.whop_promo_id).filter((id): id is string => typeof id === "string" && id.trim() !== ""),
      held: rows.length > 0,
    };
  } catch (e) {
    console.warn(
      `[membership discount] student ${studentId}: their own 30% requests could not be read, so no code is known to be their own: ${e instanceof Error ? e.message : String(e)}`,
    );
    return { promoIds: [], held: false };
  }
}

/**
 * What the request routes' fallback reads of a stored row (with `source` and `source_checked_at` where the database
 * has v113); `renewal_price` since 2026-10-26, for rowShowsUnpaid.
 */
const STORED_FALLBACK_COLUMNS = "whop_membership_id, promo_code_id, promo_code, renewal_price, discounted, checked_at";
type StoredFallbackRow = Pick<
  MembershipDiscountRow,
  "whop_membership_id" | "promo_code_id" | "promo_code" | "renewal_price" | "discounted" | "checked_at"
> & {
  source?: unknown;
  source_checked_at?: unknown;
};

/**
 * What a stored row's stamp says (THE RULE STAMP, WHO READS IT in the
 * header): this rule wrote it and nothing since; it holds no source (written
 * before v113, without the user's list, or read from a database without
 * v113); its source is an older round's word; or this rule's stamp is on it
 * with another `checked_at`, so a build that writes no source wrote over it.
 */
type StoredStamp = "this_rule" | "no_source" | "older_rule" | "written_over";

function stampOf(row: { source?: unknown; source_checked_at?: unknown; checked_at?: unknown }): StoredStamp {
  if (row.source === null || row.source === undefined) return "no_source";
  if (!isCurrentRuleSource(row.source)) return "older_rule";
  return stampedByThisRule(row) ? "this_rule" : "written_over";
}

/**
 * Whether a stored "no coupon" answers for a Whop that gives none (WHO READS
 * IT, the header): this rule wrote it and nothing wrote over it since
 * (stampedByThisRule: its `source` carries this rule's version, and its
 * `source_checked_at` is its `checked_at`), and it names no code, or this
 * student's own 30% by the promo id on their own approved or applied
 * request. Since T-122's fourth fix round the code: a source alone let in a
 * row an older build of T-122 wrote for a student holding a used code
 * (welcome50 renewing at 97.00, "no coupon" by its rule). Since its fifth the
 * stamp: a step's word alone answered from any build that wrote one, and an
 * upsert leaving the column out keeps the one already on the row.
 */
export function storedNoCouponAnswers(
  row: Pick<StoredFallbackRow, "promo_code_id"> & { source?: unknown; source_checked_at?: unknown; checked_at?: unknown },
  ownThirtyPromoIds: readonly string[],
): boolean {
  if (!stampedByThisRule(row)) return false;
  return row.promo_code_id === null || row.promo_code_id === undefined || ownThirtyPromoIds.includes(row.promo_code_id);
}

/**
 * The student's stored row, and what its stamp says (WHO READS IT in the
 * header). On a database without v113 the read naming `source` and
 * `source_checked_at` is refused (lacksSourceColumn) and made again without
 * them: the row then holds no source, so it is never known to be this
 * rule's. null when there is no row or it cannot be read.
 */
async function storedFallback(db: SupabaseClient, studentId: string): Promise<{ row: StoredFallbackRow; stamp: StoredStamp } | null> {
  const read = (columns: string) => db.from(MEMBERSHIP_DISCOUNTS_TABLE).select(columns).eq("student_id", studentId).maybeSingle();
  const withSource = await read(`${STORED_FALLBACK_COLUMNS}, source, source_checked_at`);
  if (!withSource.error) {
    const row = withSource.data as StoredFallbackRow | null;
    return row ? { row, stamp: stampOf(row) } : null;
  }
  if (!lacksSourceColumn(withSource.error)) return null;
  const bare = await read(STORED_FALLBACK_COLUMNS);
  const row = bare.error ? null : (bare.data as StoredFallbackRow | null);
  return row ? { row, stamp: "no_source" } : null;
}

/** Why a stored "no coupon" was no answer, as the log line says it (checkMembershipDiscount). */
const NOT_THIS_RULE: Record<Exclude<StoredStamp, "this_rule"> | "a_code" | "student_unread", string> = {
  no_source: "the stored row says no coupon and holds no source, so this rule did not write it",
  older_rule: "the stored row says no coupon and its source is an older rule's, so this rule did not write it",
  written_over: "the stored row says no coupon and was written over since this rule wrote it",
  a_code: "the stored row says no coupon but names a code that is not the student's own 30%, so this rule did not write it",
  student_unread: "the stored row says no coupon, and with the student's row unread only a stored coupon answers",
};

/**
 * The request routes, the approve route (D5) and "Check Whop again": Whop
 * now, by the owner's rule (judgeStudentDiscount, told the student's first
 * payment and their own approved or applied requests), then the stored row
 * for this membership (storedRowApplies) when it is a coupon, or a no coupon
 * this rule wrote, and nothing since, that names no code but the student's
 * own (storedNoCouponAnswers, WHO READS IT), a coupon alone when the
 * student's row could not be read (since T-122's fifth fix round), then
 * nothing (source "none": Whop gave no answer and nothing stored answers;
 * the request routes refuse on it, and since T-122's fourth fix round so
 * does the approve route's normal Approve). A live answer is stored, best
 * effort, so the map and the admin page catch up. Never throws. `apiKey`
 * defaults to WHOP_API_KEY; without one there is no live read. Since
 * 2026-10-26 a no coupon also carries `unpaid` (THE PAID PLAN AND THE
 * PAYMENT), Whop not showing both a real course payment and a course
 * membership on a paid plan, on which every caller but Check Whop again
 * refuses, and which Check Whop again reports (it was `noRealPayment` until
 * the owner's answers of that day; until the review before them
 * judgeStudentDiscount said it and only the cron counted it). `store: false`
 * (the 30% job's dry run, T-137) leaves Whop's answer unstored, `saved`
 * false.
 */
export async function checkMembershipDiscount(
  db: SupabaseClient,
  studentId: string,
  opts: { apiKey?: string | null; store?: boolean } = {},
): Promise<CouponCheck> {
  const apiKey = opts.apiKey === undefined ? (process.env.WHOP_API_KEY ?? null) : opts.apiKey;
  let student: StudentForCheck | undefined;
  try {
    const { data, error } = await db
      .from("students")
      .select("whop_membership_id, whop_user_id, first_paid_at")
      .eq("id", studentId)
      .maybeSingle();
    const row = data as { whop_membership_id?: string | null; whop_user_id?: string | null; first_paid_at?: string | null } | null;
    student = error
      ? undefined
      : {
          id: studentId,
          whop_membership_id: row?.whop_membership_id ?? null,
          whop_user_id: row?.whop_user_id ?? null,
          first_paid_at: row?.first_paid_at ?? null,
        };
  } catch {
    student = undefined;
  }
  // The student's own requests, read once, when the live check or the stored row needs them.
  let ownThirty: OwnThirty | null = null;
  const ownThirtyOnce = async () => (ownThirty ??= await ownThirtyOf(db, studentId));

  let liveFail: CouponCheck["liveFail"] = null;
  if (student === undefined) liveFail = "student_unread";
  else if (!apiKey) liveFail = "no_api_key";
  else {
    const own = await ownThirtyOnce();
    const started = Date.now();
    const ctx = newReadContext(apiKey, started + ROUTE_START_BUDGET_MS, started + ROUTE_ANSWER_BUDGET_MS);
    const live = await judgeStudentDiscount({ ...student, ownThirtyPromoIds: own.promoIds, holdsOwnThirty: own.held }, ctx);
    if (live.ok) {
      let saved = false;
      if (opts.store !== false) {
        try {
          const error = await upsertDiscountRows(db, [live.row], { withoutSource: false });
          if (error) console.error(`[membership discount] student ${studentId}: the live answer was not stored: ${error}`);
          else saved = true;
        } catch (e) {
          console.error(`[membership discount] student ${studentId}: the live answer was not stored: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      return {
        discounted: live.row.discounted,
        code: codeOf(live.row),
        source: "live",
        via: live.source,
        liveFail: null,
        saved,
        unpaid: live.noRealPayment || live.noPaidPlan,
        membershipId: isMembershipId(live.row.whop_membership_id) ? live.row.whop_membership_id : null,
      };
    }
    liveFail = live.fail;
  }

  // The stored row, when it was read from the membership the student has now (or when that could not be read): a
  // coupon always; no coupon only when this rule wrote it and nothing since, it names no code but the student's own,
  // and (since T-122's fifth fix round) the student's row was read, so the membership on file is known. Such a no
  // coupon says too whether the student was unpaid (rowShowsUnpaid, since 2026-10-26).
  let answer: CouponCheck = { discounted: false, code: null, source: "none", via: null, liveFail, saved: false, unpaid: false, membershipId: null };
  let notThisRule: keyof typeof NOT_THIS_RULE | null = null;
  try {
    const stored = await storedFallback(db, studentId);
    if (stored && storedRowApplies(stored.row, student?.whop_membership_id)) {
      const discounted = stored.row.discounted === true;
      const membershipId = stored.row.whop_membership_id ?? null;
      if (discounted) {
        answer = { discounted, code: codeOf(stored.row), source: "stored", via: null, liveFail, saved: false, unpaid: false, membershipId };
      } else if (student === undefined) {
        notThisRule = "student_unread";
      } else if (stored.stamp !== "this_rule") {
        notThisRule = stored.stamp;
      } else {
        const ownIds = stored.row.promo_code_id ? (await ownThirtyOnce()).promoIds : [];
        if (storedNoCouponAnswers(stored.row, ownIds)) {
          answer = {
            discounted,
            code: codeOf(stored.row),
            source: "stored",
            via: null,
            liveFail,
            saved: false,
            unpaid: rowShowsUnpaid(stored.row),
            membershipId,
          };
        } else notThisRule = "a_code";
      }
    }
  } catch {
    // No stored answer: source "none", and the caller decides (the request
    // routes refuse since the owner's review of 2026-10-21, and the approve
    // route's normal Approve since T-122's fourth fix round).
  }
  // A check that was tried and gave no answer is worth a line: without it an
  // approval refused, or an application refused, would be unexplained. With no
  // key there was nothing to try; a student row that could not be read says so
  // since the fifth fix round.
  const outcome =
    answer.source === "stored"
      ? "the stored row decides"
      : notThisRule !== null
        ? `no answer is on file (${NOT_THIS_RULE[notThisRule]})`
        : "no answer is on file";
  if (liveFail === "no_course_product" || liveFail === "no_whop_user") {
    console.warn(`[membership discount] student ${studentId}: Whop could not be asked (${liveFail}), so ${outcome}`);
  } else if (liveFail === "student_unread") {
    console.warn(`[membership discount] student ${studentId}: the student's row could not be read, so Whop was not asked and ${outcome}`);
  } else if (liveFail !== null && liveFail !== "no_api_key") {
    console.warn(`[membership discount] student ${studentId}: Whop gave no answer (${liveFail}), so ${outcome}`);
  }
  return answer;
}

export type RefreshMode = "write" | "dry";

export interface RefreshAnswer {
  ok: boolean;
  mode: RefreshMode;
  run_started_at: string;
  /** Students whose 30% window is still open (discountWindowOpen at the run's start), active or past_due. */
  in_window: number;
  /**
   * Students holding a pending request, read whatever their window or
   * membership (some are in `in_window` too): the 30% page's Applied rows,
   * so a stale stored answer heals by itself.
   */
  pending_requests: number;
  /** Left out: an approved or applied request. */
  have_the_30: number;
  /** The students this run had to check. */
  candidates: number;
  /** Answered this run, yes or no. */
  checked: number;
  /**
   * Of `checked`, by the step that answered (the header's WHICH MEMBERSHIPS
   * AND PAYMENTS): the membership on file, a course membership found through
   * the Whop user, a course payment (one on a coupon, an unpaid answer, or
   * no membership answered).
   */
  by_source: Record<DiscountSource, number>;
  /**
   * Of by_source.payment, the unpaid (THE PAID PLAN AND THE PAYMENT, the
   * header; both refused since 2026-10-26): no real course payment at all,
   * whatever the memberships say (until then only with no membership renewing
   * above 0 either); and a real course payment beside no course membership on
   * a paid plan (a free plan, no course membership at all).
   */
  no_real_payment: number;
  no_paid_plan: number;
  /**
   * Of `checked`: the students whose Whop user's list of memberships
   * answered a 404 or another 4xx (a 410 once v2 is gone), judged without it
   * by the membership on file and the payments (T-122's fourth fix round). A
   * count that jumps says the list stopped answering, and a code on a second,
   * canceled or expired membership is then seen on its payments alone; since
   * the fifth fix round each such no coupon is stored with no source, so no
   * stored fallback answers with it.
   */
  user_list_unusable: number;
  discounted: number;
  /**
   * The students the price alone refused (step 3: no code anywhere, the
   * first real course payment under 97.00), each with that payment's price
   * and billing_reason, so the owner can rule on real cases (T-122's fourth
   * fix round; the dry run is where to read it). Student ids only.
   */
  refused_by_price: { student_id: string; price: number; billing_reason: string | null }[];
  /**
   * The students a payment naming no code refused by its subtotal (step 2's
   * second half, T-122's fifth fix round: its price below its subtotal),
   * each with that price, the subtotal, the currency they are in and the
   * payment's billing_reason, so the owner can rule on real cases (a free
   * trial's checkout Whop might state at the plan's price would show here).
   * Student ids only.
   */
  refused_by_subtotal: { student_id: string; price: number; subtotal: number; currency: string | null; billing_reason: string | null }[];
  /** Rows written (0 on a dry run). */
  written: number;
  /**
   * v113's check refused this rule's stamp (refusesThisStamp: a copy of v113
   * taking other versions alone, as the one in production's tree, cac0c07),
   * so the rows were written without it (since the review of 2026-10-26; the
   * run answered 500 until then). True means the copy of v113 in this tree is
   * still to be pasted: until then no stored no coupon answers when Whop
   * does not.
   */
  stamp_refused: boolean;
  /** Students Whop gave no answer for (NO ANSWER), by kind. Their stored row stays as it was. */
  failed: Partial<Record<NoAnswer, number>>;
  /** Not reached before the time ran out: the next run starts with them. */
  left: number;
  whop_requests: number;
  retried_429: number;
  ms: number;
  /** When the run could not start or could not write: what failed. */
  error?: string;
}

/**
 * The cron's run (GET /api/cron/refresh-membership-discounts): every student
 * whose 30% window is still open at the run's start (discountWindowOpen),
 * active or past_due, and every student holding a pending request, whatever
 * their window or membership; of those, the ones with no approved or applied
 * request; those never checked first, then the longest unchecked; each
 * judged live (judgeStudentDiscount) and stored, 25 rows at a time. A student
 * whose window has closed can make no request, so is read again only while a
 * request of theirs waits: the 30% page judges that row by the stored answer,
 * and a row whose answer says a coupon offers only Reject, so the approve
 * route's own live read never runs for it (the render review's second
 * round). "dry" reads and writes nothing. A run that cannot
 * read who is in the window or who holds a pending request, or for which
 * Whop answered nothing, answers ok: false.
 */
export async function refreshMembershipDiscounts(
  db: SupabaseClient,
  opts: { mode: RefreshMode; startedAtMs: number; apiKey: string },
): Promise<RefreshAnswer> {
  const { mode, startedAtMs, apiKey } = opts;
  const answer: RefreshAnswer = {
    ok: false,
    mode,
    run_started_at: new Date(startedAtMs).toISOString(),
    in_window: 0,
    pending_requests: 0,
    have_the_30: 0,
    candidates: 0,
    checked: 0,
    by_source: { membership: 0, user: 0, payment: 0 },
    no_real_payment: 0,
    no_paid_plan: 0,
    user_list_unusable: 0,
    discounted: 0,
    refused_by_price: [],
    refused_by_subtotal: [],
    written: 0,
    stamp_refused: false,
    failed: {},
    left: 0,
    whop_requests: 0,
    retried_429: 0,
    ms: 0,
  };
  const done = (more: Partial<RefreshAnswer> = {}): RefreshAnswer => ({ ...answer, ...more, ms: Date.now() - startedAtMs });

  type Member = { id: string; whop_membership_id: string | null; whop_user_id: string | null; first_paid_at: string | null };
  const MEMBER_COLUMNS = "id, whop_membership_id, whop_user_id, first_paid_at";
  // The read starts at the earliest first payment whose window can still be open, so it stays as short as the
  // window; the window's own rule (discount.ts) then decides each student it holds.
  const inWindow = await fetchAllRowsPaginated<Member>(() =>
    db
      .from("students")
      .select(MEMBER_COLUMNS)
      .gte("first_paid_at", earliestOpenFirstPayment(startedAtMs))
      .in("membership_status", ["active", "past_due"])
      .order("id"),
  );
  if (inWindow.error) return done({ error: `students: ${inWindow.error.message}` });
  const byId = new Map(
    inWindow.data.filter((s) => discountWindowOpen(s.first_paid_at, startedAtMs)).map((s) => [s.id, s] as const),
  );
  answer.in_window = byId.size;

  // Every student holding a pending request, whatever their window or membership: the 30% page judges their
  // row by the stored answer, so a stale one (a code taken off the membership in Whop since) heals here
  // instead of holding the row to Reject. They are few.
  const pendingRead = await fetchAllRowsPaginated<{ student_id: string }>(() =>
    db.from("discount_requests").select("student_id").eq("status", "pending").order("id"),
  );
  if (pendingRead.error) return done({ error: `discount_requests (pending): ${pendingRead.error.message}` });
  const pendingIds = [...new Set(pendingRead.data.map((r) => r.student_id))];
  const outside = pendingIds.filter((id) => !byId.has(id)).sort();
  for (let i = 0; i < outside.length; i += BATCH) {
    const batch = outside.slice(i, i + BATCH);
    const r = await fetchAllRowsPaginated<Member>(() =>
      db.from("students").select(MEMBER_COLUMNS).in("id", batch).order("id"),
    );
    if (r.error) return done({ error: `students (holding a pending request): ${r.error.message}` });
    for (const s of r.data) byId.set(s.id, s);
  }
  answer.pending_requests = pendingIds.filter((id) => byId.has(id)).length;
  const members = [...byId.values()];

  const ids = members.map((m) => m.id);
  const batches: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) batches.push(ids.slice(i, i + BATCH));

  // Who has the 30% already: their membership carries the team's code, so the rule has nothing to say.
  const held = new Set<string>();
  for (const batch of batches) {
    const r = await fetchAllRowsPaginated<{ student_id: string }>(() =>
      db.from("discount_requests").select("student_id").in("student_id", batch).in("status", ["approved", "applied"]).order("id"),
    );
    if (r.error) return done({ error: `discount_requests: ${r.error.message}` });
    for (const row of r.data) held.add(row.student_id);
  }
  answer.have_the_30 = members.filter((m) => held.has(m.id)).length;

  // When each was last checked: never first, then the oldest. A failed read only loses the order.
  const lastChecked = new Map<string, string>();
  for (const batch of batches) {
    const r = await fetchAllRowsPaginated<{ student_id: string; checked_at: string }>(() =>
      db.from(MEMBERSHIP_DISCOUNTS_TABLE).select("student_id, checked_at").in("student_id", batch).order("student_id"),
    );
    if (r.error) {
      console.error(`[membership discounts] the stored rows could not be read, so the order is by id: ${r.error.message}`);
      break;
    }
    for (const row of r.data) lastChecked.set(row.student_id, row.checked_at);
  }
  const at = (id: string) => {
    const t = Date.parse(lastChecked.get(id) ?? "");
    return Number.isFinite(t) ? t : -Infinity;
  };
  const candidates = members
    .filter((m) => !held.has(m.id))
    .sort((a, b) => at(a.id) - at(b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  answer.candidates = candidates.length;

  const ctx = newReadContext(apiKey, startedAtMs + REFRESH_START_BUDGET_MS, startedAtMs + REFRESH_ANSWER_BUDGET_MS);
  const writes = { withoutSource: false, stampRefused: false };
  let pending: MembershipDiscountRow[] = [];
  let writeError: string | null = null;
  const flush = async () => {
    if (pending.length === 0 || mode === "dry" || writeError) {
      pending = [];
      return;
    }
    const rows = pending;
    pending = [];
    const error = await upsertDiscountRows(db, rows, writes);
    if (error) writeError = `${MEMBERSHIP_DISCOUNTS_TABLE}: ${error}`;
    else answer.written += rows.length;
    answer.stamp_refused = writes.stampRefused;
  };

  for (let i = 0; i < candidates.length; i++) {
    const r = await judgeStudentDiscount(candidates[i], ctx);
    if (!r.ok) {
      if (r.fail === "time_budget") {
        answer.left = candidates.length - i;
        break;
      }
      answer.failed[r.fail] = (answer.failed[r.fail] ?? 0) + 1;
      continue;
    }
    answer.checked++;
    answer.by_source[r.source]++;
    if (r.noRealPayment) answer.no_real_payment++;
    if (r.noPaidPlan) answer.no_paid_plan++;
    if (r.userListUnusable) answer.user_list_unusable++;
    if (r.row.discounted) answer.discounted++;
    if (r.byPrice) answer.refused_by_price.push({ student_id: r.row.student_id, price: r.byPrice.price, billing_reason: r.byPrice.billingReason });
    if (r.bySubtotal) {
      const s = r.bySubtotal;
      answer.refused_by_subtotal.push({ student_id: r.row.student_id, price: s.price, subtotal: s.subtotal, currency: s.currency, billing_reason: s.billingReason });
    }
    pending.push(r.row);
    if (pending.length >= WRITE_CHUNK) await flush();
    if (writeError) break;
  }
  await flush();

  answer.whop_requests = ctx.pace.requests;
  answer.retried_429 = ctx.pace.retried429;
  const failedReads = Object.values(answer.failed).reduce((s, n) => s + (n ?? 0), 0);
  if (writeError) return done({ error: writeError });
  // Whop answered no student: the shape or the key is wrong, and a run that wrote nothing must say so out loud.
  const allFailed = answer.checked === 0 && failedReads > 0;
  // Whop answered nothing before the time ran out (it hangs): no read failed, none was checked, every candidate is left.
  // That run read nothing either, so it says so too (the review's fix round: it answered ok).
  const stalled = answer.checked === 0 && answer.left > 0;
  if (stalled && !allFailed) return done({ ok: false, error: "Whop answered no membership read before the time ran out, so nothing was checked. The next run tries again." });
  return done({ ok: !allFailed });
}
