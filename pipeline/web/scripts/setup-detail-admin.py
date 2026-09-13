"""Create a local admin credential outside every project/media-serving directory."""
from pathlib import Path
import secrets

target = Path.home() / 'AppData' / 'Local' / 'ShortformAutomation' / 'detail-admin-key.txt'
target.parent.mkdir(parents=True, exist_ok=True)
try:
    with target.open('x', encoding='utf-8') as out:
        out.write(secrets.token_urlsafe(32) + '\n')
except FileExistsError:
    pass
print('Admin key file: ' + str(target))
print('Existing credentials are preserved. Open this file locally to sign in; do not share it.')
