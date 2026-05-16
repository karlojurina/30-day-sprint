-- ============================================================
-- v30: Trim DM templates to one emoji per message.
--
-- Karlo's note (2026-05-16): one emoji is enough; two or three feels
-- awkward and overstated. The original seed had an opener emoji and
-- a closer emoji on most templates — keeping the closer (it sets the
-- warm sign-off vibe) and dropping the opener.
--
-- This is a destructive UPDATE: anything edited via /admin/templates
-- before today gets overwritten. Run only if you want the canonical
-- one-emoji bodies; otherwise edit in the UI instead.
-- ============================================================

update templates set body =
$$Hey {firstName}!

Welcome to EcomTalent — so happy you're here! I'm Astrid, and I'll be your point of contact while you're with us.

Love that you're up for a call to kick things off! On the call I'll help you get fully set up and walk you through exactly how to get to your first win inside the program as fast as possible.

Grab a time that works for you here: {bookingLink}

In the meantime, two easy things to do:

— Hop into Discord and introduce yourself in the community chat. There are tons of awesome students on the same path as you right now, and they love saying hi to new folks.

— Start watching the modules whenever you're ready. We can break down anything you're unsure about when we hop on the call.

If a question comes up while you're getting started, the Discord community is your best first stop — students going through the exact same thing can usually jump in and help fast. Anything bigger that needs me, I'm here too.

Can't wait to chat soon 🎉$$
where scenario_id = 'D1.A';

update templates set body =
$$Hey {firstName}!

Welcome to EcomTalent — so happy you're here! I'm Astrid, and I'll be your point of contact while you're with us.

Totally cool that you'd rather get right into it without a call. Here's a quick rundown of what you're getting and how to get going.

**Before you do anything else — please watch this video:** {videoLink}

It's Karlo personally walking you through the 30-Day Sprint dashboard — what it is, how it works, and how to use it. It'll save you a ton of time and confusion once you're in there.

Once you've watched it, jump into the dashboard here: {programLink}

A couple things worth knowing as you get started:

— **You're not on your own.** I'll be checking in along the way, and the coaches in the community give feedback on your work whenever you're ready to share it.

— **There's a 30% discount on month two** waiting for you inside the dashboard. The video covers exactly how it works.

If a question comes up while you're getting started, the Discord community is your best first stop — students going through the exact same thing can usually jump in and help fast. Anything bigger that needs me, I'm here too.

So happy to have you! Let's get going 🚀$$
where scenario_id = 'D1.B';

update templates set body =
$$Hey {firstName}!

You finished all of region 1 - both action items shipped, every lesson done. A lot of students don't make it through this part. Real respect.

The fact that you actually shipped the ads instead of overthinking them is the part that matters most. Trust me on that.

Region 2 just unlocked - the ad formats get a bit heavier from here (vsl + high-prod). You've handled the first two, you'll handle these.

Keep cooking 👨‍🍳$$
where scenario_id = 'W1.1';

update templates set body =
$$Hey {firstName}

Saw you've been going through the lessons - 10+ watched. That means you care.

Want to be real with you for a sec though.

There's a moment where this stops being about watching and starts being about doing. You're there. Two action items waiting at the end of region 1, and I get it - they probably feel scary right now.

Watching feels productive. Shipping feels exposed.

The shipping part is where things actually click. You don't need another lesson to make you "ready" - what you've already learned is enough to make a rough one. Coaches will give you real feedback either way.

Pick one. Give it 30 minutes. Hit submit. It doesn't have to be good, it just has to leave your hands.

You've got this 💪$$
where scenario_id = 'W1.2';

update templates set body =
$$Hey {firstName}

Quick check-in - saw you joined a few days ago but haven't really had a chance to watch lessons yet. Totally normal, life gets messy.

One honest thought though.

The first 30 minutes is the hardest part. Once you sit down and actually start, the program kind of pulls you in.

Most students who tell me "I just can't get into it" - it's almost always because they're trying to find the perfect time to start instead of just starting.

If you can carve out 30 minutes today, that's enough. Don't try to do it all - just one lesson, one click. The rest gets easier from there.

Anything blocking you I can help with? Quick reply telling me what's going on would help me figure out the right next step 💛$$
where scenario_id = 'W1.3';

update templates set body =
$$Hey {firstName}

Wanted to reach out personally - noticed you signed up but haven't watched any lessons on Whop yet. No judgment, just checking on you.

If life got loud, I get it. We've all been there.

But I'd hate for you to lose what you joined for just because you couldn't find the first 30 minutes to start. The whole program builds on momentum, and the longer you wait, the heavier that first step feels. Trust me, I've seen it a bunch of times.

If you need any help getting started, message me here or drop a question in the community - tons of students who started exactly where you are now and would love to help.

We're rooting for you 💛$$
where scenario_id = 'W1.4';

update templates set body =
$$Hey {firstName}!

Region 2 done. That's the heaviest content region in the whole program - the editing breakdowns alone are hours of footage. Getting all the way through is no joke.

You should see the 30% discount unlock in your dashboard now - go grab it whenever you're ready.

Region 3 is up next: static ads, money-making methods, creative strategy. Different gear from R1 and R2 but you've shown you can handle whatever's next.

Keep cooking 👨‍🍳$$
where scenario_id = 'W2.1';

update templates set body =
$$Hey {firstName}

Both your vsl and high-prod ads are in. That's 4 ad formats shipped total now (organic, ugc, vsl, high-prod). Trust me, a lot of students never get this far.

Take a sec to look at that.

Coaches will drop feedback as they review.

One thing worth flagging - now you've got 4 different ad formats shipped, that's a real portfolio building up. When you start applying to jobs on the job board, this is exactly the stuff brands look for.

Keep going - you're building serious momentum 🔥$$
where scenario_id = 'W2.2';

update templates set body =
$$Hey {firstName}

Saw you've been going through region 2 lessons - nice, you're staying with it.

Want to flag something though.

The two action items at the start of region 2 (vsl + high-production) are still sitting there. You don't have to wait until you've watched everything to ship them - the longer you wait, the heavier they feel. Trust me on that.

These two are a bit more involved than the first two ads. That's normal, they're meant to stretch you. But the goal isn't to make them perfect, just to ship and get real feedback from the coaches.

Pick one. Give yourself a chunk of time today or tomorrow. Submit it. You've already proven you can do this with R1 - second pair just needs you to start.

You've got this 💪$$
where scenario_id = 'W2.3';

update templates set body =
$$Hey {firstName}

Quick check-in - saw you're still working through region 1. Totally okay, just wanted to flag something so you can make an informed choice.

If you want to grab the 30% off month two, the countdown in your dashboard is moving. To make it in time, you'd need to finish region 1 and get all the way through region 2 before it hits zero.

It's still possible if you push for a few days. Or if life's a lot right now, totally fine to keep moving at your own pace - the program isn't going anywhere, and tbh the 30% isn't the real point of being here.

Either way, wanted you to know where you stand. Anything I can help with? 👋$$
where scenario_id = 'W2.4';

update templates set body =
$$Hey {firstName}

Wanted to reach out personally - saw you're still in region 1. Want to be real with you for a sec.

We want you to win. Genuinely. That's why this community exists in the first place, and it's why I'm in your DMs right now instead of letting you fade out.

But you can't win if you don't actually watch the lessons and take action on them. That's the only way anything changes - trust me on that.

So forget timelines, forget pace, forget whether you're "behind." None of that matters. Just pick up the next lesson today and keep moving from there.

Anything I can help with? Even a quick reply telling me what's going on would help me figure out where to point you.

We're rooting for you 💛$$
where scenario_id = 'W2.5';

update templates set body =
$$Hey {firstName}

Wanted to check in - noticed you haven't been around in about a week. No judgment, just making sure you're okay.

If something's going on outside the program, I get it. Life shows up sometimes, the program has to wait.

But if you're not sure whether to keep going, I'd really like to know. Sometimes there's a small thing in the way making the whole program feel impossible, and naming it can make all the difference.

If you want to talk through it, message me here. Or just drop a question in the community when you're ready to come back - tons of students there who've been exactly where you are. The lessons are right where you left them, the next one is enough.

We're rooting for you 💛$$
where scenario_id = 'W2.7';

update templates set body =
$$Hey {firstName}!

Region 3 done. Want to point something out.

By this point, you know how to make ads across multiple formats. You understand the strategy behind why they work. You know how to land clients. And you've seen exactly how the bounty system pays out.

You're equipped now. That's not me hyping you up - that's just facts.

What that means: opportunities are starting to open up for you. The job board in discord has new postings most days, and you're qualified for a lot of them. You'll start shipping bounties for real brands in region 4 too.

Keep crushing it ⛏️$$
where scenario_id = 'W3.1';

update templates set body =
$$Hey {firstName}

Wanted to reach out - saw you're still in region 2. Want to be real with you.

You've got time left in the sprint, but the road ahead is steep. All of region 3 + region 4 still waiting. To finish the full sprint, you'd need to do about 2 lessons a day from here. Doable but tight.

If you can push, finishing all 30 days is genuinely worth it. Region 4 is where everything you've put in so far finally pays off - that's the part of the program that makes the work click.

If life is too much right now, no shame. Just keep moving at whatever pace you can. The lessons aren't going anywhere.

Either way, let me know how I can help 💛$$
where scenario_id = 'W3.2';

update templates set body =
$$Hey {firstName}

Wanted to check in - noticed you haven't been around for about a week. Just making sure you're okay.

The most impactful part of the program is still ahead. Region 4 is where everything you've put in so far actually pays off - that's where the program clicks for most people.

If something pulled you away, I get it. But if you're on the edge of giving up, I'd really like to know first. Sometimes there's a small thing blocking the next step that we can sort out together.

Message me here when you can. Or drop a question in the community if you want to ease back in - tons of students there who've been exactly where you are.

We're rooting for you 💛$$
where scenario_id = 'W3.3';

update templates set body =
$$Hey {firstName}

Wanted to flag something — you're in the last stretch of the sprint, and Region 3 isn't quite wrapped up yet. Not a huge deal, but want to be honest with you about what's coming.

Region 4 is where you actually ship real ad bounties for real brands — it's where everything you've done so far actually gets applied. If you don't get there, you'll have done a lot of learning without the moment where it all becomes real.

The math: a few solid pushes over the next few days and you're in R4. Even getting one or two bounty submissions in before Day 30 is enough to make the whole sprint pay off.

Anything I can help with to clear the path?

We're rooting for you 💛$$
where scenario_id = 'W4.1';

update templates set body =
$$Hey {firstName}

Day 30! You made it to the end of the sprint and you're still here — that itself says something about you.

Saw you didn't fully wrap up Region 4, but that's totally fine. Honestly, finishing the sprint perfectly isn't the goal — the goal is what you do from here.

If you can, finishing the last bit of R4 is worth it — shipping at least one real ad bounty is the experience that makes this whole thing click. Otherwise, keep watching lessons you haven't gotten to, or start applying what you've learned to real work. The program isn't going anywhere.

Let me know what you're thinking, or just keep going at your own pace.

Proud of you for sticking with it 💛$$
where scenario_id = 'W4.2';

update templates set body =
$$Hey {firstName}

Wanted to reach out — haven't seen you in about a week, and we're in the final stretch of the sprint.

Region 4 is happening right now in the program — the part where students actually ship real ad bounties for real brands. It's the moment most of these 30 days were building toward. If you've got the bandwidth to come back in, even briefly, this is the part worth showing up for.

If you've made a different call, totally understand. Life happens. But I'd hate for you to walk away right before the most useful part without at least knowing that's actually your call.

Message me here if you want to talk through it, or just jump back in. The lessons are right where you left them.

We're rooting for you 💛$$
where scenario_id = 'W4.3';

update templates set body =
$$Hey {firstName}

Saw your membership wrapped up — wanted to send one final message.

No hard sell, no pitch. Just want to say thanks for giving this a real shot. EcomTalent isn't for everyone, and that's actually okay.

If something specific made the program not work for you, I'd genuinely love to hear it — even a one-line reply helps us build something better for the next person coming in.

And if you ever want to come back, the door's open. No pressure.

Take care 💛$$
where scenario_id = 'W4.4';

update templates set body =
$$Hey {firstName}

Saw you came back and finished a lesson — really glad to see you.

No big speech, just wanted to say it's good to have you back. The program is right here whenever you're ready, and you don't need to catch up on everything — just take it at whatever pace works.

If anything's been blocking you or you want to talk it through, I'm here. Otherwise, just keep going.

Proud of you for picking it back up 💛$$
where scenario_id = 'X.1';
