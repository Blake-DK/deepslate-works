# deepslate-installer: DeepslateWorks.exe, its .sha256 and VERSION, plus the small script that copies them into dist/ci.
# Built by .github/workflows/installer.yml (publish) with the folder of the built exe as context and this folder's
# copy-out.sh put beside it. The files sit at /, where deploy.sh's `docker cp` also finds them until it is retired.
FROM busybox:stable

COPY DeepslateWorks.exe DeepslateWorks.exe.sha256 VERSION /
COPY copy-out.sh /usr/local/bin/copy-out.sh

CMD ["sh", "/usr/local/bin/copy-out.sh"]
