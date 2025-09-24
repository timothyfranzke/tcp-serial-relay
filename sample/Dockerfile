FROM ubuntu:latest

RUN apt-get update && apt-get install -y sudo git nodejs npm

RUN useradd -m -s /bin/bash admin
RUN echo "admin ALL=(ALL) ALL" >> /etc/sudoers

RUN usermod -aG sudo admin
RUN echo "admin:password" | chpasswd

USER admin
WORKDIR /home/admin
