# Lab 16 — P2P sin servidor

## Resultado

El repositorio contiene el cliente `peer.js`, el topic determinístico y los
experimentos de Hypercore. En la primera ejecución ambos procesos hicieron
`join` pero no encontraron peers. En la segunda ejecución sí hubo conexión y
se intercambió el ping en ambos sentidos.

Resultado final del kickoff: `connected: sí`; topic corto:
`5f12612ab966…`.

Topic de clase:

- semilla: `cs031-s19-20261013`
- SHA-256 completo: `5f12612ab966c649334876369cb3709426e018034a02911d4f86bc021775959a`
- topic corto: `5f12612ab966…`

Logs: [`peer-20230117.log`](logs/peer-20230117.log) y
[`peer-20230005.log`](logs/peer-20230005.log).

## Kickoff y diagnóstico

En la ejecución exitosa, `20230117` registró `CONNECTION` a las 07:24:12.366
UTC y recibió `ping desde 20230005`. `20230005` registró `CONNECTION` a las
07:24:12.362 UTC y recibió `ping desde 20230117`.

Los peer IDs truncados observados fueron `fee51c017dc1…` y `e15c9627095d…`.
El runtime dejó `remote_address=N/A`; por tanto, no se obtuvo una dirección
remota visible en estos logs. La primera ejecución fallida queda conservada
como antecedente en los mismos archivos.

El diagnóstico compatible con esos datos es que no hubo otro peer alcanzable
en el topic durante la prueba o que la red bloqueó UDP/NAT traversal. El
programa deja previsto un timeout de 120 s y registra la dirección remota
cuando sí existe una conexión. El dato de dirección remota no estuvo
disponible porque no hubo socket conectado.

## Flujo técnico

```text
topic (32 bytes)
    │
    ▼
Hyperswarm join(topic)
    │
    ▼
DHT lookup / bootstrap nodes
    │
    ▼
holepunch o relay ──► conexión cifrada entre peers
                              │
                              ▼
                    ping / Hypercore replication
```

Hyperswarm usa nodos bootstrap de la red DHT para encontrar participantes.
Cuando es posible, intenta hole punching; si la topología no lo permite,
puede depender de un relay. Aunque no haya un provider de la aplicación, sí
se usó infraestructura mínima de descubrimiento y transporte: bootstrap nodes,
DHT y, potencialmente, relays.

## Transferencia de archivo

`file-transfer.js` usa `fixtures/p2p-test-file.txt`, un archivo de 2,863 bytes
sin PII ni contenido de terceros. El seeder publica un Hypercore y usa la
clave pública del core como topic; el downloader abre el mismo core y replica
los bloques. La integridad se comprueba con SHA-256:

`91aa76d03ccdb5a85a75805a84b8547862ce8206f0956909b30313ab4f709095`

Ejecución realizada: el downloader encontró al seeder (`peer=3afc9e946a5b…`),
recibió 12 bloques y guardó el archivo en `received/p2p-test-file.txt`.
El hash coincidió (`integridad=OK`). El `REP_ERROR Readable stream closed`
posterior ocurre al cerrar el stream después de completar la transferencia y
no afectó la integridad.

Comandos:

```text
npm run seeder
node file-transfer.js --role downloader --key <KEY_HEX_DEL_SEEDER>
```

## Kill-seeder

`kill-seeder.js` divide el archivo en 45 bloques de 64 bytes, inicia un
seeder y un downloader, y programa el kill aproximadamente en el bloque 22.
En la ejecución exitosa, el seeder y downloader se conectaron, y el kill
ocurrió en el bloque 22 de 45: el downloader llevaba 22 bloques y 1,408 bytes.
No había otro seeder (`otro_seeder=NO`). Después apareció `ECONNRESET`, que es
la señal esperada al destruir la conexión. La transferencia quedó incompleta
y no fue reanudable con un único seeder. El resultado exitoso queda archivado
en [`kill-seeder-success-20261013.log`](logs/kill-seeder-success-20261013.log);
[`kill-seeder.log`](logs/kill-seeder.log) conserva una repetición posterior
que no encontró conexión.

Comando:

```text
npm run kill-seeder
```

## Liability

En un modelo centralizado, el host/provider mantiene servidores, disponibilidad,
moderación, almacenamiento y respuesta ante reclamaciones. En P2P parte de
esa carga pasa a usuarios que ejecutan el runtime y seedean contenido: ellos
aportan ancho de banda, disponibilidad y pueden exponer su IP al contraparte.
El topic no proporciona anonimato; solamente sirve para descubrir peers.

Napster conservaba un índice central y fue un punto claro para órdenes y
responsabilidad. Grokster intentó separarse del control directo sobre los
intercambios, pero la promoción y el conocimiento del uso infractor fueron
relevantes para el análisis de responsabilidad. BitTorrent distribuye el
intercambio entre peers y reduce el punto único de control, pero no elimina
la responsabilidad potencial de operadores, desarrolladores o usuarios: la
arquitectura cambia dónde están los hechos y los incentivos, no convierte
automáticamente el uso en lícito.

Oración 15-2026: la responsabilidad debe evaluarse según el rol real de cada
actor, su control, conocimiento, incentivos y medidas de mitigación, no sólo
según la etiqueta “centralizado” o “P2P”.

## Aprendizaje

El experimento separa tres capas: el topic permite intentar el descubrimiento,
la conexión directa transporta datos y Hypercore verifica/replica bloques.
En esta ejecución la primera capa no produjo un peer conectado; el fallo es
un resultado de red válido y limita las conclusiones sobre el ping. El
kill-seeder confirma además que P2P no significa disponibilidad garantizada:
la resiliencia depende de que existan otros seeders con las piezas necesarias.
