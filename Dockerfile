FROM debian:bookworm-slim

WORKDIR /app

# Install system dependencies & Bun & yt-dlp
RUN apt-get update && apt-get install -y sqlite3 ca-certificates curl ffmpeg python3 unzip && \
    curl -fsSL https://bun.sh/install | bash && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    rm -rf /var/lib/apt/lists/*

# Add Bun to PATH
ENV PATH="/root/.bun/bin:${PATH}"

# Copy dependency specifications first for Docker layer caching
COPY package.json bun.lock tsconfig.json ./

# Install project dependencies
RUN bun install --frozen-lockfile || bun install

# Copy project source
COPY . .

# Ensure data and downloads directories exist
RUN mkdir -p data downloads

# Set production environment
ENV NODE_ENV=production

# Run the bot
CMD ["bun", "run", "src/index.ts"]
