/*
 * @Author: Innei
 * @Date: 2020-06-24 20:01:32
 * @LastEditTime: 2020-10-21 19:16:37
 * @LastEditors: Innei
 * @FilePath: /server/src/core/adapt/fastify.ts
 * @Coding with Love
 */
import * as FastifyMultipart from 'fastify-multipart'
import type _FastifyMultipart from 'fastify-multipart'
import { FastifyAdapter } from '@nestjs/platform-fastify'
import { isDev } from '../../utils'
import * as Session from 'fastify-secure-session'
import type _Session from 'fastify-secure-session'
const SECRET = process.env.SECRET || 'dasfasdxzxczfs'
export const fastifyApp = new FastifyAdapter({
  logger: isDev,
  trustProxy: true,
})
fastifyApp.register((FastifyMultipart as any) as typeof _FastifyMultipart, {
  addToBody: true,
  limits: {
    fields: 10, // Max number of non-file fields
    fileSize: 1024 * 1024 * 6, // limit size 6M
    files: 5, // Max number of file fields
  },
})

fastifyApp.register((Session as any) as typeof _Session, {
  secret: 'asdasdasdasdsadsaxsaxassdasdqwdasdxczardja'.concat(SECRET),
  salt: SECRET.repeat(16).slice(0, 16) || 'mq9hDxBVDbspDR6n',
  cookie: { secure: false, maxAge: 84000 },
})

fastifyApp.getInstance().addHook('onRequest', (request, reply, done) => {
  const origin = request.headers.origin
  if (!origin) {
    request.headers.origin = request.headers.host
  }

  done()
})
