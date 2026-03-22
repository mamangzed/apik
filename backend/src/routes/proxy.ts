import { Router, Request, Response } from 'express';
import axios, { AxiosRequestConfig, AxiosError } from 'axios';
import { ProxyRequest, ProxyResponse } from '../types';
import https from 'https';
import http from 'http';

const router = Router();

// Reuse sockets across requests to reduce repeated TCP/TLS handshake cost.
const httpAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
});

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
  keepAlive: true,
  maxSockets: 100,
  maxFreeSockets: 20,
});

router.post('/', async (req: Request, res: Response) => {
  const proxyReq: ProxyRequest = req.body;

  if (!proxyReq.url || !proxyReq.method) {
    return res.status(400).json({ error: 'Missing url or method' });
  }

  const startTime = Date.now();

  try {
    const config: AxiosRequestConfig = {
      method: proxyReq.method.toLowerCase() as AxiosRequestConfig['method'],
      url: proxyReq.url,
      headers: proxyReq.headers || {},
      timeout: proxyReq.timeout || 30000,
      maxRedirects: proxyReq.followRedirects !== false ? 5 : 0,
      validateStatus: () => true, // don't throw on any status
      responseType: 'arraybuffer',
      httpAgent,
      // Allow self-signed certificates for local dev while keeping TLS sessions reusable.
      httpsAgent,
    };

    if (proxyReq.body && !['GET', 'HEAD', 'OPTIONS'].includes(proxyReq.method.toUpperCase())) {
      config.data = proxyReq.body;
    }

    const response = await axios(config);
    const elapsed = Date.now() - startTime;

    const responseHeaders: Record<string, string> = {};
    for (const [key, val] of Object.entries(response.headers)) {
      if (val !== undefined) {
        responseHeaders[key] = Array.isArray(val) ? val.join(', ') : String(val);
      }
    }

    let bodyStr: string;
    const contentType = responseHeaders['content-type'] || '';
    const buffer = Buffer.from(response.data);

    if (
      contentType.includes('text') ||
      contentType.includes('json') ||
      contentType.includes('xml') ||
      contentType.includes('javascript') ||
      contentType.includes('html')
    ) {
      bodyStr = buffer.toString('utf8');
    } else {
      bodyStr = buffer.toString('base64');
    }

    const proxyResponse: ProxyResponse = {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
      body: bodyStr,
      size: buffer.length,
      time: elapsed,
      redirected: false,
    };

    return res.json(proxyResponse);
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const axiosError = err as AxiosError;

    if (axiosError.isAxiosError) {
      if (axiosError.code === 'ECONNABORTED') {
        return res.json({
          status: 0,
          statusText: 'Request Timeout',
          headers: {},
          body: 'Request timed out',
          size: 0,
          time: elapsed,
          error: 'TIMEOUT',
        } as ProxyResponse);
      }
      if (axiosError.code === 'ECONNREFUSED' || axiosError.code === 'ENOTFOUND') {
        return res.json({
          status: 0,
          statusText: 'Connection Failed',
          headers: {},
          body: `Connection failed: ${axiosError.message}`,
          size: 0,
          time: elapsed,
          error: 'CONNECTION_FAILED',
        } as ProxyResponse);
      }
    }

    return res.status(500).json({
      status: 0,
      statusText: 'Proxy Error',
      headers: {},
      body: `Proxy error: ${(err as Error).message}`,
      size: 0,
      time: elapsed,
      error: 'PROXY_ERROR',
    });
  }
});

export default router;
