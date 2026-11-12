# 5v5 Match Manager

1. Create a Supabase project, open SQL Editor, run `schema.sql`.
2. Copy `.env.example` to `.env` and fill in the project URL and anon key (Settings > API).
3. `npm install && npm run dev`. Players use `/`, the organizer uses `/admin`.
4. Deploy (Vercel/Netlify): set the same two env vars. `vercel.json` handles the `/admin` route.

The admin PIN is stored hashed in `admin_config`, never in the frontend. To change it:
`update admin_config set pin_hash = extensions.crypt('NEW_PIN', extensions.gen_salt('bf'));`

## Teams & weekly reset
- Ratings (1-5) are set in `/admin` and saved by player name, so returning players keep them. They are only reachable through PIN-checked functions, never from `/`.
- With 15 confirmed players the admin page splits teams automatically (or press "חלק כוחות אוטומטית"), then adjust with the dropdowns and publish.
- Draft teams live in an admin-only table. `team_index` on `registrations` is filled only while teams are published, so the public can't see teams early.
- "איפוס משחק לשבוע הבא" deletes registrations and drafts, unpublishes, and updates time/price/Bit link. `player_ratings` is kept.
- `schema.sql` is safe to re-run on an existing project; it replaces `admin_list_registrations` with a version that also returns draft teams.
