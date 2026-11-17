FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    LANG=th_TH.UTF-8 \
    LC_ALL=th_TH.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
    libreoffice-writer \
    libreoffice-calc \
    libreoffice-core \
    fontconfig \
    poppler-utils \
    locales \
    && sed -i '/th_TH.UTF-8/s/^# //g' /etc/locale.gen \
    && locale-gen \
    && rm -rf /var/lib/apt/lists/*

# Install TH SarabunIT9 & TH Sarabun New fonts for accurate Thai PDF rendering
COPY fonts/*.ttf /usr/share/fonts/truetype/thsarabun/
RUN fc-cache -fv

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY resources ./resources

RUN mkdir -p /app/storage/rendered /app/storage/signatures

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
