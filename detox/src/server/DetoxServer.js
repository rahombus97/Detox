const _ = require('lodash');
const WebSocket = require('ws');
const {URL} = require('url');
const log = require('../utils/logger').child({ __filename });

const WebSocketServer = WebSocket.Server;

const CLOSE_TIMEOUT = 10000;
const ROLE_TESTER = 'tester';
const ROLE_TESTEE = 'testee';

class DetoxServer {
  constructor({ url, standalone = false }) {
    const { host, port } = new URL(url);

    this.wss = new WebSocketServer({ host, port });
    this.sessions = {};
    this.standalone = standalone;

    log.info(`server listening on localhost:${this.wss.options.port}...`);
    this._setup();
  }

  _setup() {
    this.wss.on('connection', (ws) => {
      let sessionId;
      let role;
      ws.on('message', (str) => {
        try {
          const action = JSON.parse(str);
          if (!action.type) {
            return;
          }
          if (action.type === 'login') {
            if (action.params && action.params.sessionId && action.params.role) {
              sessionId = action.params.sessionId;
              role = action.params.role;
              log.debug({ event: 'LOGIN' }, `role=${role}, sessionId=${sessionId}`);
              _.set(this.sessions, [sessionId, role], ws);
              action.type = 'loginSuccess';
              this.sendAction(ws, action);
              log.debug({ event: 'LOGIN_SUCCESS' }, `role=${role}, sessionId=${sessionId}`);
            }
          } else if (sessionId && role) {
            log.trace({ event: 'MESSAGE', action: action.type }, `role=${role} action=${action.type} (sessionId=${sessionId})`);
            this.sendToOtherRole(sessionId, role, action);
          }
        } catch (err) {
          log.debug({ event: 'ERROR', err }, `Invalid JSON received, cannot parse`, err);
        }
      });

      ws.on('error', (e) => {
        log.warn({ event: 'WEBSOCKET_ERROR', role, sessionId }, `${e && e.message} (role=${role}, session=${sessionId})`);
      });

      ws.on('close', () => {
        if (sessionId && role) {
          log.debug({ event: 'DISCONNECT' }, `role=${role}, sessionId=${sessionId}`);

          if (role === ROLE_TESTEE) {
            this.sendToOtherRole(sessionId, role, { type: 'testeeDisconnected', messageId: -0xc1ea });
          }

          if (this.standalone && role === ROLE_TESTER) {
            this.sendToOtherRole(sessionId, role, { type: 'testerDisconnected', messageId: -1 });
          }

          _.set(this.sessions, [sessionId, role], undefined);
        }
      });
    });
  }

  sendAction(ws, action) {
    ws.send(JSON.stringify(action) + '\n ');
  }

  sendToOtherRole(sessionId, role, action) {
    const otherRole = role === ROLE_TESTEE ? ROLE_TESTER : ROLE_TESTEE;
    const ws = _.get(this.sessions, [sessionId, otherRole]);
    if (ws && ws.readyState === WebSocket.OPEN) {
      this.sendAction(ws, action);
    } else {
      log.debug({ event: 'CANNOT_FORWARD' }, `role=${otherRole} not connected, cannot fw action (sessionId=${sessionId})`);

      if (role === ROLE_TESTER && action.type === 'cleanup') {
        this.sendToOtherRole(sessionId, otherRole, {
          type: 'testeeDisconnected',
          messageId: action.messageId,
        });
      }
    }
  }

  async close() {
    await this._closeWithTimeout();
  }

  _closeWithTimeout() {
    return new Promise((resolve) => {
      const handle = setTimeout(() => {
        log.warn({ event: 'TIMEOUT' }, 'Detox server closed ungracefully on a timeout!!!');
        resolve();
      }, CLOSE_TIMEOUT);

      this.wss.close(() => {
        log.debug({ event: 'WS_CLOSE' }, 'Detox server connections terminated gracefully');
        clearTimeout(handle);
        resolve();
      });
    });
  }
}

module.exports = DetoxServer;
