# Deploying Tutor on Azure (free with Azure for Students)

The whole app runs on one small Azure server (a "virtual machine"): the website, Postgres, the Redis cache, MongoDB logs, and **Caddy**, which gives you HTTPS automatically. One script does most of the work.

**What it costs:** Azure for Students gives **$100 of credit for 12 months**, with no card needed. This server uses roughly **$20–25 of credit a month**, so it runs for about **4–5 months** non-stop, or longer if you stop it when you don't need it. When the credit runs out, Azure switches the server off; **it never charges you**.

Total time: about 30–40 minutes, done once.

---

## Part 1: Create the server

1. Go to **https://portal.azure.com** and sign in with the account where Azure for Students is active.
2. In the search bar at the top, type **Virtual machines** → open it → **Create** → **Azure virtual machine**.
3. Fill in the **Basics** tab:
   | Field | Value |
   |---|---|
   | Subscription | **Azure for Students** |
   | Resource group | **Create new** → `tutor-rg` |
   | Virtual machine name | `tutor` |
   | Region | **(Asia Pacific) Central India** |
   | Availability options | **No infrastructure redundancy required** |
   | Security type | **Standard** |
   | Image | **Ubuntu Server 24.04 LTS – x64 Gen2** |
   | Size | click **See all sizes**, search `B1ms`, pick **Standard_B1ms** (1 vCPU, 2 GiB) → **Select** |
   | Authentication type | **Password** |
   | Username | `azureuser` |
   | Password | a strong password. **Write it down**: you'll type it to log in. |
   | Public inbound ports | **Allow selected ports** → tick **HTTP (80)**, **HTTPS (443)**, **SSH (22)** |

   > If B1ms says "not available" in Central India, change the Region to **South India** or **East US** and try again. Student subscriptions don't offer every size everywhere.
4. Click **Next: Disks** → set **OS disk type** to **Standard SSD** (cheaper, and plenty fast).
5. Click **Next: Networking** → tick **Delete public IP and NIC when VM is deleted**.
6. Click **Next: Management**. If **Enable auto-shutdown** is ticked, **untick it**. Otherwise Azure turns your site off every evening.
7. Click **Review + create** → **Create**. Wait about 1 minute, then click **Go to resource**.

## Part 2: Give it a web address (free, built into Azure)

8. On the VM's page, next to **Public IP address**, click the IP (for example `20.193.45.67`). This opens the IP's settings.
9. Open **Settings → Configuration**:
   - **Assignment:** choose **Static**, so the address never changes.
   - **DNS name label:** type something like `tutor-nitin`.
   - Click **Save**.

   Your web address is now shown under the label, for example:
   ```
   tutor-nitin.centralindia.cloudapp.azure.com
   ```
   Copy it; you'll need it in step 12.

## Part 3: Set up the server (one command)

10. Open **PowerShell** on your laptop and log in to the server (use your own IP from step 8):
    ```powershell
    ssh azureuser@20.193.45.67
    ```
    - It asks "Are you sure you want to continue connecting?" → type `yes`.
    - Type the password from step 3. It stays invisible while you type; that's normal.
11. Now you're on the server. Paste these lines and press Enter:
    ```bash
    git clone https://github.com/Nitingupta0/Tutor.git
    cd Tutor
    bash scripts/setup-server.sh
    ```
    If it asks for your server password (`[sudo] password`), type it again.
12. It asks two questions:
    - **Groq API key:** paste your key. To paste in PowerShell, right-click.
    - **Domain:** paste your address from step 9, for example `tutor-nitin.centralindia.cloudapp.azure.com`.

    Then wait about **10–15 minutes**. It installs everything, creates a random database password on the server, starts the app and fills the database. It ends with **"Done! Open https://…"**.
13. Open that link. 🎉

---

## Updating the site after you change the code

**By hand:** log in (step 10) and run:
```bash
cd Tutor && bash scripts/update.sh
```

**Automatically (optional):** after this, every merge into `main` updates the site by itself.
1. Log in to the server (step 10) and run these three lines. They create a key that only GitHub will use:
   ```bash
   ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N "" -C github-deploy
   cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys
   cat ~/.ssh/github_deploy
   ```
   The last line prints a private key, starting `-----BEGIN OPENSSH PRIVATE KEY-----`. Select all of it, **including** the BEGIN and END lines, and copy it.
2. On GitHub: **Nitingupta0/Tutor** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**. Add three:
   | Name | Value |
   |---|---|
   | `SERVER_HOST` | your web address from step 9 |
   | `SERVER_USER` | `azureuser` |
   | `SERVER_SSH_KEY` | the key you copied |
3. Test it: **Actions** tab → **Deploy to server** → **Run workflow**.

## Adding your own notes (optional)

Your own notes stay private and never go to GitHub. From **PowerShell on your laptop** (use your IP; it asks for the server password):
```powershell
scp -r D:\Placement_Prep\DSA\* azureuser@20.193.45.67:~/Tutor/private-notes/
```
Then log in to the server (step 10) and run:
```bash
cd Tutor && bash scripts/update.sh --reindex
```

## Keeping an eye on credit

- **Check your remaining credit:** go to https://www.microsoftazuresponsorships.com/balance, or search **Subscriptions** in the portal → **Azure for Students**.
- **Pause the site when you don't need it:** open the VM → **Stop**. This stops the main cost while keeping all your data. Click **Start** to bring it back; it comes up with the same address, and the app starts by itself.
- **When placement season is over:** open **Resource groups** → `tutor-rg` → **Delete resource group**. That removes everything.

## If something goes wrong

| What you see | What to do |
|---|---|
| `ssh` says "Connection timed out" | Check the VM is **Running**, and that step 3 allowed **SSH (22)**: VM → **Networking** should list port 22. |
| The site doesn't load right after setup | Wait 2 minutes (HTTPS takes a moment the first time), then refresh. |
| Certificate or "Not secure" error | Make sure you typed exactly the address from step 9 in step 12. To change it: `cd Tutor && nano .env`, fix the `SITE_ADDRESS=` line, save (Ctrl+O, Enter, Ctrl+X), then run `sudo docker compose -f docker-compose.prod.yml restart caddy`. |
| "The tutor is having a moment" | Run `cd Tutor && sudo docker compose -f docker-compose.prod.yml logs app --tail 50` and share the output. |
| Fetch says "No problems indexed yet" | Run `cd Tutor && bash scripts/update.sh --codeforces`. |
| The Groq key was typed wrong | Run `cd Tutor && nano .env`, fix the `GROQ_API_KEY=` line, save, then run `bash scripts/update.sh`. |
| Want to see what's running | `sudo docker compose -f docker-compose.prod.yml ps` |
