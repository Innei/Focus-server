import { ApiProperty } from '@nestjs/swagger'
import { Transform } from 'class-transformer'
import { IsDate, IsOptional } from 'class-validator'

export class AnalyzeDto {
  @Transform((v) => new Date(parseInt(v)))
  @IsOptional()
  @IsDate()
  @ApiProperty({ type: 'string' })
  from?: Date

  @Transform((v) => new Date(parseInt(v)))
  @IsOptional()
  @IsDate()
  @ApiProperty({ type: 'string' })
  to?: Date
}
