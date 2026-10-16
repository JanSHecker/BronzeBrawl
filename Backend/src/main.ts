import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureHttpBodyParser } from './http.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureHttpBodyParser(app);
  app.enableShutdownHooks();
  app.enableCors();
  await app.listen(process.env.PORT || 3000);
}
bootstrap();
