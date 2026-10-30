# Deploy a locally tested production bundle without running a Node build on a
# memory-constrained server. The source release and bundle share one manifest.
FROM nginx:1.27-alpine
COPY web/dist /usr/share/nginx/html
# A private build directory may use umask 077; nginx workers must read assets.
RUN chmod -R a+rX /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=5 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
