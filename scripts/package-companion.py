"""Build the downloadable source ZIP from the current Companion files."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

ROOT = Path(__file__).resolve().parents[1]
FILES = ('README.md', 'start.cmd', 'companion.py', 'network.py', 'replay.py',
         'ranking.py', 'index.html', 'ui.js', 'style.css')

if __name__ == '__main__':
    destination = ROOT / 'Frontend/src/public/downloads/bronze-brawl-companion.zip'
    destination.parent.mkdir(parents=True, exist_ok=True)
    with ZipFile(destination, 'w', compression=ZIP_DEFLATED) as archive:
        for name in FILES:
            archive.write(ROOT / 'Companion' / name, arcname='bronze-brawl-companion/' + name)
    print('Companion source ZIP updated.')
