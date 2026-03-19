FROM nginx:alpine

# Remove default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Custom nginx config for SPA-friendly static serving
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy app files
COPY index.html /usr/share/nginx/html/
COPY forecast.js /usr/share/nginx/html/
COPY data.js /usr/share/nginx/html/
COPY api.html /usr/share/nginx/html/
COPY methodology.html /usr/share/nginx/html/

# Copy cache if it exists (populated by daily-cache job)
COPY cache/ /usr/share/nginx/html/cache/

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget -qO- http://localhost/health || exit 1
