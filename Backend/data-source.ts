import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { getDataSourceOptions } from './ormconfig';

// Environment must be supplied by Compose/CI/the operator; never load a secret file implicitly.
export default new DataSource(getDataSourceOptions(new ConfigService()));
