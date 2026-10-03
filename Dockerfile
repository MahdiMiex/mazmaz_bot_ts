FROM oven/bun:1-debian

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y sqlite3 ca-certificates curl && rm -rf /var/lib/apt/lists/*

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
