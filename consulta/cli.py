from __future__ import annotations

import argparse
import getpass
import tempfile
from pathlib import Path

from cryptography.fernet import Fernet
from dotenv import load_dotenv, set_key

from consulta.backup import create_backup, restore_backup
from consulta.config import Settings
from consulta.security import Security
from consulta.store import Store


def main():
    parser = argparse.ArgumentParser(description="Administração do Consulta em Foco")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("--development", action="store_true")
    doctor = commands.add_parser("create-doctor")
    doctor.add_argument("--username", required=True)
    for name in ("serve", "demo"):
        cmd = commands.add_parser(name)
        cmd.add_argument("--port", type=int, default=8000)
    backup = commands.add_parser("backup")
    backup.add_argument("destination", type=Path)
    restore = commands.add_parser("restore")
    restore.add_argument("archive", type=Path)
    restore.add_argument("destination", type=Path)
    args = parser.parse_args()
    if args.command == "init":
        path = Path(".env")
        if path.exists():
            raise SystemExit("A configuração .env já existe; não foi substituída.")
        path.write_text(Path(".env.example").read_text(), encoding="utf-8")
        path.chmod(0o600)
        set_key(str(path), "APP_ENCRYPTION_KEY", Fernet.generate_key().decode())
        if args.development:
            set_key(str(path), "APP_ENV", "development")
            set_key(str(path), "APP_BASE_URL", "http://127.0.0.1:8000")
        print(
            "Configuração criada. Guarde a chave fora do servidor e configure o domínio antes de usar pacientes reais."
        )
        return
    if args.command == "demo":
        import uvicorn

        from consulta.api import create_app

        with tempfile.TemporaryDirectory(prefix="consulta-demo-") as folder:
            settings = Settings(
                data_dir=Path(folder),
                encryption_key=Fernet.generate_key().decode(),
                base_url=f"http://127.0.0.1:{args.port}",
                environment="demo",
            )
            print(
                "Demonstração isolada. Use apenas informações fictícias. Os dados serão removidos ao encerrar."
            )
            uvicorn.run(create_app(settings), host="127.0.0.1", port=args.port, access_log=False)
        return
    load_dotenv()
    settings = Settings.from_env()
    if args.command == "restore":
        restore_backup(args.archive, args.destination, settings.encryption_key)
        print(
            "Backup restaurado e sessões invalidadas. Verifique o resultado antes de alterar APP_DATA_DIR."
        )
        return
    store = Store(settings.data_dir, settings.encryption_key)
    if args.command == "create-doctor":
        password = getpass.getpass("Nova senha (mínimo 14 caracteres): ")
        if password != getpass.getpass("Repita a senha: "):
            raise SystemExit("As senhas não conferem")
        Security(store, settings).create_doctor(args.username, password)
        print("Conta médica criada. Complete o perfil e o aviso de privacidade na aplicação.")
    elif args.command == "backup":
        create_backup(store, args.destination)
        print(
            "Backup cifrado e manifesto autenticado criados. A chave deve ser guardada separadamente."
        )
    else:
        import uvicorn

        from consulta.api import create_app

        uvicorn.run(create_app(settings), host="127.0.0.1", port=args.port, access_log=False)


if __name__ == "__main__":
    main()
