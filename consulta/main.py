from dotenv import load_dotenv

from consulta.api import create_app
from consulta.config import Settings

load_dotenv()
app = create_app(Settings.from_env())
