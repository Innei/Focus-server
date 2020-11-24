/*
 * @Author: Innei
 * @Date: 2020-05-10 15:31:44
 * @LastEditTime: 2020-07-08 21:42:06
 * @LastEditors: Innei
 * @FilePath: /mx-server/src/utils/ip.ts
 * @Coding with Love
 */

import { FastifyRequest } from 'fastify'

export const getIp = (request: FastifyRequest) => {
  // @ts-ignore
  let ip: string =
    request.headers['x-forwarded-for'] ||
    request.ip ||
    request.raw.connection.remoteAddress ||
    request.raw.socket.remoteAddress ||
    undefined
  if (ip && ip.split(',').length > 0) {
    ip = ip.split(',')[0]
  }
  return ip
}
