import {
  IsUrl,
  IsOptional,
  IsString,
  IsNotEmpty,
  IsArray,
} from 'class-validator'
import { ApiProperty } from '@nestjs/swagger'

export class SEODto {
  @IsString({ message: '标题必须是字符串' })
  @IsNotEmpty({ message: '不能为空!!' })
  @IsOptional()
  @ApiProperty({ example: '我的小窝' })
  title: string

  @IsString({ message: '描述信息必须是字符串' })
  @IsNotEmpty({ message: '不能为空!!' })
  @IsOptional()
  @ApiProperty({ example: '欢迎来到我的小窝' })
  description: string

  @IsOptional()
  @IsUrl({ require_protocol: true }, { message: '站点图标必须为正确的网址' })
  icon?: string

  @IsArray({ message: '关键字必须为一个数组' })
  @IsOptional()
  @ApiProperty({ example: ['blog', 'mx-space'] })
  keywords?: string[]
}

export class UrlDto {
  @IsUrl({ require_protocol: true })
  @IsOptional()
  @ApiProperty({ example: 'http://127.0.0.1:2323' })
  webUrl: string

  @IsUrl({ require_protocol: true })
  @IsOptional()
  @ApiProperty({ example: 'http://127.0.0.1:9528' })
  adminUrl: string

  @IsUrl({ require_protocol: true })
  @IsOptional()
  @ApiProperty({ example: 'http://127.0.0.1:2333' })
  serverUrl: string

  @IsUrl()
  @IsOptional()
  @ApiProperty({ example: 'http://127.0.0.1:8080' })
  wsUrl: string
}
