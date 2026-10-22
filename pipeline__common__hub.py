"""Upload helpers with polite pacing + backoff (stays inside HF free limits)."""
import os, time
from huggingface_hub import HfApi

def upload(folder, repo_id, path_in_repo, msg, private=False, tries=6):
    api = HfApi(token=os.environ["HF_TOKEN"])
    api.create_repo(repo_id, repo_type="dataset", private=private, exist_ok=True)
    for i in range(tries):
        try:
            return api.upload_folder(folder_path=folder, repo_id=repo_id, repo_type="dataset", path_in_repo=path_in_repo, commit_message=msg)
        except Exception as e:  # 429 / 5xx: wait and retry
            wait = 60 * 2 ** i; print(f"upload failed ({e}); retry in {wait}s"); time.sleep(wait)
    raise SystemExit("upload failed after retries")
