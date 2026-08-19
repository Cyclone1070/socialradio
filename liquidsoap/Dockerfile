FROM savonet/liquidsoap:v2.2.4

USER root
RUN mkdir -p /etc/liquidsoap /app/storage && chown -R liquidsoap:liquidsoap /etc/liquidsoap /app/storage

USER liquidsoap
COPY radio.liq /etc/liquidsoap/radio.liq

ENTRYPOINT ["liquidsoap", "/etc/liquidsoap/radio.liq"]
