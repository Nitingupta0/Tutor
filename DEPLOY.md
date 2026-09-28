# Deploying Tutor for free (Hugging Face + Neon)

- **Neon** hosts the database (Postgres with pgvector). Free, no credit card.
- **Hugging Face Spaces** runs the app. Free, no credit card.
- **GitHub** re-publishes the app automatically every time you merge into `main`.

Redis (cache) and MongoDB (logs) are skipped. The app works fine without them.

> The free Space goes to sleep after about 2 days with no visitors. The next visitor waits about a minute while it wakes up.

Total time: about 20–30 minutes, done once.

---

## Part 1: Create the database (Neon)

1. Go to **https://neon.tech** and click **Sign up**. "Continue with GitHub" is easiest.
2. Create a project:
   - Project name: `tutor`
   - Region: **AWS US East (N. Virginia)**. This is close to where Hugging Face runs, which keeps the app fast.
3. On the project dashboard, click **Connect**. Copy the **connection string**. It looks like:
   ```
   postgresql://neondb_owner:xxxxxxxx@ep-something.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
   Keep it private: it works like a password.

## Part 2: Fill the database (from your laptop)

4. In your project folder on your laptop, get the latest code:
   ```powershell
   git checkout main
   git pull origin main
   ```
5. Open your `.env` file and add this line, pasting your Neon connection string after the `=`:
   ```
   DATABASE_URL=postgresql://neondb_owner:xxxxxxxx@ep-something.us-east-1.aws.neon.tech/neondb?sslmode=require
   ```
6. Run these **one at a time**, waiting for each to finish:
   ```powershell
   python ingest.py
   python ingest.py D:\Placement_Prep\DSA --append
   python -m corpus.codeforces --max-rating 2000
   ```
   - The first line uploads the bundled notes.
   - The second line (optional) adds your own notes.
   - The third line (optional) is what makes Fetch mode work.

   While `DATABASE_URL` is in `.env`, the app on your laptop also uses the Neon database. Delete that line to go back to the local Docker database.

## Part 3: Create the app (Hugging Face)

7. Go to **https://huggingface.co** and sign up. Remember your **username**.
8. Click your profile picture → **New Space**, and fill in:
   - Space name: `tutor`
   - SDK: **Docker** → **Blank**
   - Hardware: **CPU basic · Free**
   - Visibility: **Public**

   Then click **Create Space**. It will be empty for now; that's expected.
9. In the new Space, open **Settings** → **Variables and secrets** → **New secret**, and add these two:
   | Name | Value |
   |---|---|
   | `GROQ_API_KEY` | your Groq key |
   | `DATABASE_URL` | the Neon connection string from step 3 |
10. Create a key that lets GitHub publish to your Space: profile picture → **Settings** → **Access Tokens** → **Create new token** → choose type **Write** → name it `github-deploy` → **Create**. Copy the token; it starts with `hf_`.

## Part 4: Connect GitHub to Hugging Face

11. Open **https://github.com/Nitingupta0/Tutor** → **Settings** → **Secrets and variables** → **Actions**.
12. On the **Secrets** tab, click **New repository secret**:
    - Name: `HF_TOKEN`
    - Value: the `hf_…` token from step 10
13. On the **Variables** tab, click **New repository variable**:
    - Name: `HF_SPACE`
    - Value: `<your-huggingface-username>/tutor` (for example `nitingupta0/tutor`)
14. Open the **Actions** tab → **Deploy to Hugging Face** (left side) → **Run workflow** → **Run workflow**. Wait for the green tick, which takes about 30 seconds.

## Part 5: Open your app

15. Go back to your Space on Hugging Face. It shows **Building** for about 5–10 minutes the first time, then **Running**.
16. Your public link is:
    ```
    https://<your-huggingface-username>-tutor.hf.space
    ```

From now on, **every merge into `main` updates the live app automatically**.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| The Actions run says "HF_TOKEN or HF_SPACE not configured yet" | Redo steps 12–13. The names must match exactly. |
| The Actions run fails with "403" or "Authentication" | The token must be type **Write** (step 10). Create a new one and update `HF_TOKEN`. |
| The Space shows **Build error** | Click **Logs** → **Build** on the Space and share the last lines. |
| The app says "The tutor is having a moment" | Check both secrets in step 9, then click **Restart Space** in Settings. |
| Fetch says "No problems indexed yet" | Run the Codeforces command in step 6. |
| "Slow down a little…" | That's the spam limit: 20 questions per minute per visitor. To change it, add a Space variable `RATE_LIMIT_PER_MINUTE`. |
