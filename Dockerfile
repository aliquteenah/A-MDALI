FROM node:lts-buster

# تثبيت أداة ffmpeg الضرورية لتنزيل وتحويل الصوت والفيديو والملصقات
RUN apt-get update && \
    apt-get install -y ffmpeg webp graphicsmagick imagemagick && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install && npm install -g pm2

COPY . .

EXPOSE 10000

CMD ["npm", "start"]
