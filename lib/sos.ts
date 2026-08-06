/**
 * Hackathon demo notification for SOS alerts.
 *
 * The real FCM/SMS integration ships later — for now this only logs where
 * the demo alert WOULD go. The number comes from NEXT_PUBLIC_DEMO_SOS_PHONE
 * (set in .env.local / Vercel env vars) and is never hardcoded in code.
 */
export function notifySosSmsDemo(): void {
  console.log("SOS would be sent to: " + process.env.NEXT_PUBLIC_DEMO_SOS_PHONE);
}