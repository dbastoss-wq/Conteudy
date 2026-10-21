FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml requirements.lock ./
COPY agent ./agent
RUN pip install --no-cache-dir -c requirements.lock . && useradd --uid 10001 --create-home agent \
    && mkdir -p /app/data /app/knowledge && chown -R agent:agent /app
COPY --chown=agent:agent knowledge ./knowledge
USER agent
EXPOSE 8000
CMD ["uvicorn", "agent.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
