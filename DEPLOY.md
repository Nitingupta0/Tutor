# Deploying Tutor on AWS (free for up to 6 months)

The whole app runs on one small AWS server: the website, Postgres, the Redis cache, MongoDB logs, and **Caddy**, which gives you HTTPS automatically. One script does most of the work.

**What it costs:** new AWS accounts on the **Free plan** get $100–$200 in credits, valid for 6 months. This server uses roughly **$20–25 of credits a month**. On the Free plan AWS **does not charge your card**. When the credits or the 6 months run out, the account closes unless you choose to upgrade.

> ⏰ The 6 months start when you create the account, so create it shortly before placement season begins.

Total time: about 30–40 minutes, done once.

---

## Part 1: Create an AWS account

1. Go to **https://aws.amazon.com** → **Create an AWS account**.
2. When asked to choose a plan, pick the **Free plan**, not the Paid plan. It needs a card to verify your identity, but won't charge it.
3. After signing in, pick **Asia Pacific (Mumbai)** from the region menu (top-right, next to your name). This keeps the site fast for visitors in India.
4. *(Optional)* The AWS home page lists small "Explore AWS" tasks. Completing them adds up to $100 more in credits.

## Part 2: Create the server

5. In the search bar at the top, type **EC2** and open it → **Launch instance**. Fill in:
   | Field | Value |
   |---|---|
   | Name | `tutor` |
   | OS image | **Ubuntu** → **Ubuntu Server 24.04 LTS** |
   | Instance type | **t3.small** |
   | Key pair | **Create new key pair** → name `tutor-key` → type RSA, format `.pem` → **Create**. A file downloads; keep it safe. |
   | Network settings | tick **Allow SSH traffic**, **Allow HTTPS traffic from the internet** and **Allow HTTP traffic from the internet** |
   | Configure storage | change **8** to **20** GiB (gp3) |

   Then click **Launch instance**.
6. Give the server a fixed address, so it doesn't change when the server restarts:
   - In the EC2 left menu, open **Elastic IPs** → **Allocate Elastic IP address** → **Allocate**.
   - Select the new address → **Actions** → **Associate Elastic IP address** → choose the `tutor` instance → **Associate**.
   - Write the address down (for example `13.233.45.67`).

## Part 3: Get a free web address (recommended)

Without this, your site works at `http://13.233.45.67`, and browsers show it as "Not secure". With it, you get a proper `https://` link.

7. Go to **https://www.duckdns.org** and sign in with GitHub.
8. Type a name (for example `tutor-nitin`) → **add domain**.
9. In the **current ip** box next to it, paste your Elastic IP from step 6 → **update ip**.

Your address is now `tutor-nitin.duckdns.org`.

## Part 4: Set up the server (one command)

10. In EC2 → **Instances**, select `tutor` → **Connect** → **EC2 Instance Connect** tab → **Connect**. A terminal opens in your browser.
11. Paste these lines and press Enter:
    ```bash
    git clone https://github.com/Nitingupta0/Tutor.git
    cd Tutor
    bash scripts/setup-server.sh
    ```
12. It asks two questions:
    - **Groq API key:** paste your key.
    - **Domain:** type `tutor-nitin.duckdns.org` (your name from step 8), or just press Enter to use the IP address.

    Then wait about **10–15 minutes**. It installs everything, creates a random database password on the server, starts the app and fills the database. It ends with **"Done! Open https://…"**.
13. Open that link. 🎉

---

## Updating the site after you change the code

**By hand:** open the browser terminal (step 10) and run:
```bash
cd Tutor && bash scripts/update.sh
```

**Automatically (optional):** after this, every merge into `main` updates the site by itself.
1. On GitHub: **Nitingupta0/Tutor** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add two:
   | Name | Value |
   |---|---|
   | `EC2_HOST` | your Elastic IP (for example `13.233.45.67`) |
   | `EC2_SSH_KEY` | open `tutor-key.pem` in Notepad and copy **everything**, including the `-----BEGIN…` and `-----END…` lines |
2. Test it: **Actions** tab → **Deploy to server** → **Run workflow**.

## Adding your own notes (optional)

Your own notes stay private and never go to GitHub. From **PowerShell on your laptop**, in the folder where `tutor-key.pem` is:
```powershell
icacls tutor-key.pem /inheritance:r
icacls tutor-key.pem /grant:r "$($env:USERNAME):(R)"
scp -i tutor-key.pem -r D:\Placement_Prep\DSA\* ubuntu@13.233.45.67:~/Tutor/private-notes/
```
(Use your own Elastic IP. The two `icacls` lines are needed only once; Windows otherwise refuses to use the key.)

Then, in the browser terminal on the server:
```bash
cd Tutor && bash scripts/update.sh --reindex
```

## Keeping an eye on credits

- **Check your remaining credits:** search **Billing** → **Credits**, or open the **Free Tier** page.
- **Pause the site when you don't need it:** EC2 → select `tutor` → **Instance state** → **Stop**. Your data is kept, and it uses far fewer credits (only the disk and the IP address). **Start** it again whenever you need it.
- **When placement season is over:** **Terminate** the instance, then release the Elastic IP (**Elastic IPs** → **Actions** → **Release**).

## If something goes wrong

| What you see | What to do |
|---|---|
| The site doesn't load right after setup | Wait 2 minutes (HTTPS takes a moment the first time), then refresh. |
| "Not secure" or a certificate error on the duckdns link | Check that DuckDNS shows the **same IP** as your Elastic IP (step 9), then run `cd Tutor && sudo docker compose -f docker-compose.prod.yml restart caddy`. |
| "The tutor is having a moment" | Run `cd Tutor && sudo docker compose -f docker-compose.prod.yml logs app --tail 50` and share the output. |
| Fetch says "No problems indexed yet" | Run `cd Tutor && bash scripts/update.sh --codeforces`. |
| The Groq key was typed wrong | Run `cd Tutor && nano .env`, fix the `GROQ_API_KEY=` line, save (Ctrl+O, Enter, Ctrl+X), then run `bash scripts/update.sh`. |
| Want to see what's running | `sudo docker compose -f docker-compose.prod.yml ps` |
