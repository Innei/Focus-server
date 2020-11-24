/*
 * @Author: Innei
 * @Date: 2020-05-21 11:05:42
 * @LastEditTime: 2020-10-18 20:52:50
 * @LastEditors: Innei
 * @FilePath: /server/src/main.ts
 * @Coding with Love
 */

import { NestFactory } from '@nestjs/core'
import { NestFastifyApplication } from '@nestjs/platform-fastify'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { mkdirSync } from 'fs'
import { AllExceptionsFilter } from 'apps/server/src/core/filters/any-exception.filter'
import { ResponseInterceptor } from 'apps/server/src/core/interceptors/response.interceptors'
import { AppModule } from './app.module'
import { DATA_DIR, TEMP_DIR } from './constants'
import { fastifyApp } from './core/adapt/fastify'
import { ExtendsIoAdapter } from './core/gateway/extend.gateway'
import { isDev } from './utils'

const PORT = parseInt(process.env.PORT) || 2333
const APIVersion = 1
const Origin = process.env.ORIGIN || ''

// ready for start server
mkdirSync(DATA_DIR, { recursive: true })
mkdirSync(TEMP_DIR, { recursive: true })

// bootstrap server
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    fastifyApp,
  )
  app.useWebSocketAdapter(new ExtendsIoAdapter(app))
  app.useGlobalFilters(new AllExceptionsFilter())
  app.useGlobalInterceptors(new ResponseInterceptor())

  const hosts = Origin.split(',').map((host) => new RegExp(host, 'i'))

  app.enableCors({
    origin: (origin, callback) => {
      const allow = hosts.some((host) => host.test(origin))

      callback(null, allow)
    },
    credentials: true,
  })

  app.setGlobalPrefix(isDev ? '' : `api/v${APIVersion}`)
  if (isDev) {
    const options = new DocumentBuilder()
      .setTitle('API')
      .setDescription('The blog API description')
      .setVersion(`${APIVersion}`)
      .addSecurity('bearer', {
        type: 'http',
        scheme: 'bearer',
      })
      .addBearerAuth()
      .build()
    const document = SwaggerModule.createDocument(app, options)
    SwaggerModule.setup('api-docs', app, document)
  }

  await app.listen(PORT, '0.0.0.0', () => {
    if (isDev) {
      console.log(`http://localhost:${PORT}/api-docs`)
    }
  })
}
bootstrap()
