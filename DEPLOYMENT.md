# Deployment Guide for Finance Seer

## 🚀 Deployment Options

### 1. Vercel (Recommended for Next.js)

#### Prerequisites
- Vercel account (free tier available)
- GitHub account with project repository

#### Steps
1. **Push to GitHub:**
   ```bash
   git init
   git add .
   git commit -m "Initial Finance Seer commit"
   git branch -M main
   git remote add origin https://github.com/YOUR_USERNAME/finance-seer.git
   git push -u origin main
   ```

2. **Deploy to Vercel:**
   - Go to [vercel.com](https://vercel.com)
   - Click "New Project"
   - Import your GitHub repository
   - Configure environment variables (in Project Settings → Environment Variables)
   - Click "Deploy"

3. **Environment Variables:**
   ```
   OPENAI_API_KEY = your_api_key_here
   OPENAI_API_URL = https://api.openai.com/v1/chat/completions (optional)
   ```

#### Notes
- SQLite works but data resets when using Vercel Functions (ephemeral /tmp)
- For persistent data, migrate to PostgreSQL:
  - [Railway](https://railway.app) - Free PostgreSQL tier
  - [Render](https://render.com) - Free PostgreSQL tier
  - [Supabase](https://supabase.com) - Free PostgreSQL

### 2. Railway.app

#### Steps
1. **Connect GitHub repository:**
   - Go to [railway.app](https://railway.app)
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Connect your repository

2. **Add PostgreSQL (for persistent data):**
   - Click "Add Service" → "Add from Marketplace"
   - Select "PostgreSQL"
   - Variables auto-populate

3. **Configure Node.js:**
   - Set environment variables
   - Deployment auto-triggers on GitHub push

4. **Update lib/db.ts for PostgreSQL:**
   Replace SQLite with PostgreSQL client (pg library):
   ```bash
   npm install pg
   ```

### 3. Render.com

1. **Create PostgreSQL database:**
   - Dashboard → Create New → PostgreSQL
   - Copy connection string

2. **Deploy Web Service:**
   - New → Web Service
   - Connect GitHub repo
   - Set environment variables
   - Deploy

### 4. Self-Hosted (VPS/Dedicated Server)

#### Prerequisites
- VPS (DigitalOcean, Linode, AWS EC2, etc.)
- Node.js 18+ installed
- PM2 or similar process manager

#### Steps
1. **SSH into server:**
   ```bash
   ssh root@YOUR_SERVER_IP
   ```

2. **Install dependencies:**
   ```bash
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs
   sudo npm install -g pm2
   ```

3. **Clone repository:**
   ```bash
   git clone https://github.com/YOUR_USERNAME/finance-seer.git
   cd finance-seer
   npm install
   ```

4. **Build:**
   ```bash
   npm run build
   ```

5. **Start with PM2:**
   ```bash
   pm2 start npm --name "finance-seer" -- start
   pm2 startup
   pm2 save
   ```

6. **Setup Nginx reverse proxy:**
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

7. **Setup SSL with Let's Encrypt:**
   ```bash
   sudo apt-get install certbot python3-certbot-nginx
   sudo certbot --nginx -d your-domain.com
   ```

### 5. Docker Deployment

#### Build Docker Image
```dockerfile
FROM node:18-alpine

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build Next.js
RUN npm run build

# Expose port
EXPOSE 3000

# Start application
CMD ["npm", "start"]
```

#### Build and Run
```bash
docker build -t finance-seer .
docker run -p 3000:3000 -e OPENAI_API_KEY=xxx finance-seer
```

#### Push to Docker Hub
```bash
docker tag finance-seer YOUR_USERNAME/finance-seer
docker push YOUR_USERNAME/finance-seer
```

#### Deploy to Docker Compose
```yaml
version: '3.8'

services:
  app:
    image: finance-seer:latest
    ports:
      - "3000:3000"
    environment:
      - OPENAI_API_KEY=xxx
    volumes:
      - ./data:/app/data

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=finance_seer
      - POSTGRES_PASSWORD=securepassword
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

## 📊 Production Checklist

- [ ] Environment variables properly configured
- [ ] Database migrated to persistent storage (PostgreSQL recommended)
- [ ] SSL/HTTPS enabled
- [ ] Monitoring setup (Sentry, New Relic, etc.)
- [ ] Backup strategy implemented
- [ ] Rate limiting configured
- [ ] API keys secured (no hardcoding)
- [ ] CORS properly configured
- [ ] Health checks implemented
- [ ] Error logging enabled

## 🔒 Security Considerations

1. **Never commit .env files:**
   ```bash
   echo ".env.local" >> .gitignore
   ```

2. **Use environment variables** for all secrets

3. **Enable HTTPS** in production

4. **Regular updates:**
   ```bash
   npm audit
   npm update
   ```

5. **Database backups** (automated daily)

6. **Monitor error logs** regularly

## 🚨 Troubleshooting Deployment

### Error: "Module not found: better-sqlite3"
- If deploying to serverless (Vercel), use PostgreSQL instead
- Or use `@vscode/sqlite3` package which works better with serverless

### Error: "Port already in use"
- Change port: `PORT=3001 npm start`

### Database errors
- Ensure database connection string is correct
- Check database user permissions
- Verify database is accessible from deployment environment

### Build failures
- Check Node.js version (18+ required)
- Clear node_modules: `rm -rf node_modules && npm install`
- Check memory limits on build server

## 📈 Performance Optimization

1. **Enable caching:**
   - Set-Cookie headers for API responses
   - Use Next.js ISR (Incremental Static Regeneration)

2. **Optimize images:**
   - Use Next.js Image component
   - WebP format support

3. **Database optimization:**
   - Create indexes (already done in code)
   - Regular VACUUM for SQLite
   - Analyze query performance

4. **CDN for static assets:**
   - Vercel auto-includes CDN
   - Or use Cloudflare for self-hosted

## 📞 Getting Help

If deployment issues occur:
1. Check deployment platform's documentation
2. Review application logs
3. Test locally first: `npm run dev`
4. Check environment variables
5. Verify database connectivity

---

**Happy Deploying! 🚀**
