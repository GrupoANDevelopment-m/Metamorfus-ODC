"""Adapter for nginx-skill — site configuration, reload, enable/disable.

The nginx-skill package has shell scripts in scripts/:
  create-site.sh, safe-reload.sh, site-disable.sh, site-enable.sh.
"""
import json
import subprocess
import os
import shutil

SCRIPTS_DIR = "/workspace/skill-pkgs/extracted/nginx-skill-main/nginx-skill-main/scripts"


def skill(organism, context):
    """Run an nginx management action.
    context = {"action": "test_config" | "reload" | "create_site" | "enable_site" | "disable_site" | "list_sites",
               "domain": "example.com", "upstream": "http://localhost:3000"}
    """
    action = context.get("action", "test_config")
    nginx_bin = shutil.which("nginx") or "/usr/sbin/nginx"

    if action == "test_config":
        # Always test before reloading. nginx binary may not be present
        # in dev envs — return a graceful error in that case.
        if not shutil.which("nginx") and not os.path.exists(nginx_bin):
            return {"ok": False, "test_passed": False, "error": "nginx not installed",
                    "hint": "apt install nginx"}
        try:
            r = subprocess.run([nginx_bin, "-t"], capture_output=True, text=True, timeout=15)
        except FileNotFoundError:
            return {"ok": False, "test_passed": False, "error": "nginx binary not found"}
        return {
            "ok": r.returncode == 0,
            "stdout": r.stdout.strip(),
            "stderr": r.stderr.strip(),
            "test_passed": r.returncode == 0,
        }

    if action == "reload":
        # safe-reload.sh wraps the test-then-reload sequence.
        script = os.path.join(SCRIPTS_DIR, "safe-reload.sh")
        if not os.path.exists(script):
            return {"error": f"safe-reload.sh not found at {script}"}
        r = subprocess.run(["bash", script], capture_output=True, text=True, timeout=30)
        return {"ok": r.returncode == 0, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}

    if action == "create_site":
        domain = context.get("domain", "")
        upstream = context.get("upstream", "http://localhost:3000")
        if not domain:
            return {"error": "domain is required for create_site"}
        script = os.path.join(SCRIPTS_DIR, "create-site.sh")
        if not os.path.exists(script):
            return {"error": f"create-site.sh not found at {script}"}
        r = subprocess.run(["bash", script, domain, upstream], capture_output=True, text=True, timeout=30)
        return {
            "ok": r.returncode == 0,
            "site": domain,
            "upstream": upstream,
            "stdout": r.stdout.strip(),
            "stderr": r.stderr.strip(),
        }

    if action == "enable_site":
        domain = context.get("domain", "")
        script = os.path.join(SCRIPTS_DIR, "site-enable.sh")
        if not os.path.exists(script):
            return {"error": f"site-enable.sh not found at {script}"}
        r = subprocess.run(["bash", script, domain], capture_output=True, text=True, timeout=15)
        return {"ok": r.returncode == 0, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}

    if action == "disable_site":
        domain = context.get("domain", "")
        script = os.path.join(SCRIPTS_DIR, "site-disable.sh")
        if not os.path.exists(script):
            return {"error": f"site-disable.sh not found at {script}"}
        r = subprocess.run(["bash", script, domain], capture_output=True, text=True, timeout=15)
        return {"ok": r.returncode == 0, "stdout": r.stdout.strip(), "stderr": r.stderr.strip()}

    if action == "list_sites":
        sites_dir = "/etc/nginx/sites-enabled"
        if os.path.isdir(sites_dir):
            sites = sorted(os.listdir(sites_dir))
            return {"ok": True, "sites": sites}
        return {"error": f"sites-enabled not found at {sites_dir}"}

    return {"error": f"unknown action: {action}"}
