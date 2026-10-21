from dotenv import load_dotenv

from agent.api import create_app

load_dotenv()
app = create_app()
